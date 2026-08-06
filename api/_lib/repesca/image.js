// api/repesca/image.js
// Proxy de la imagen del coche en repesca. Mismo patrón que /api/daily-image
// pero pinned a un carId concreto + gateado por la repesca activa del
// usuario: solo sirve los bytes si el usuario tiene una repesca ACTIVA HOY
// para ese carId (es decir, ya pasó por /api/repesca/start).
//
// Esto evita que cualquier usuario logueado pueda llamar /repesca/image?
// carId=<X> y obtener la imagen de un coche al que aún no juega.

import sharp from "sharp";
import { resolveRealCarId } from "../repesca-token.js";
import { getSupabaseAdmin, getMissingAdminEnvs } from "../supabase.js";
import { requireUser } from "../auth.js";
import { todayInMadrid } from "../date.js";
import { methodGuard, applyCors } from "../http.js";
import { captureServerError } from "../sentry.js";
import { clampZoomBase, cropPctForAttempt, ZOOM_ATTEMPTS } from "../zoom.js";

// Crop durante la partida = el del ÚLTIMO intento (el más amplio que ve un
// jugador legítimo), igual que /api/daily-image. Ahora es POR COCHE: depende
// de su zoom_base (cropPctForAttempt). El cliente cierra el resto por CSS con
// los mismos scales que el juego diario (src/lib/zoom.js). Antes servíamos la
// imagen ENTERA en repesca y el zoom era client-side — con DevTools veías el
// coche desnudo nada más arrancar.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  // Esta foto NO se pide con <img src>, se baja con fetch + Authorization para
  // convertirla en blob (el gate mira user_guesses, y una etiqueta img no puede
  // mandar el Bearer). Al ser fetch, sí aplica CORS: desde la app el origen es
  // https://localhost y hay preflight. Sin esto el OPTIONS moría en 405 y la
  // repesca se quedaba con el skeleton para siempre.
  if (applyCors(req, res)) return; // preflight OPTIONS / headers CORS
  if (methodGuard(req, res, ["GET", "HEAD"])) return;

  try {
    if (!getSupabaseAdmin()) {
      console.error(`[repesca/image] missing env vars: ${getMissingAdminEnvs().join(", ")}`);
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const { user, authClient, error: authError } = await requireUser(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    // El cliente nos pasa el PSEUDO (lo recibió de /api/garage). Lo
    // resolvemos al cars.id real antes de cualquier otra operación.
    const pseudoCarId = String(req.query?.carId || "").trim();
    if (!pseudoCarId) {
      return res.status(400).json({ error: "Missing carId" });
    }
    const { data: allCarRows, error: allCarsErr } = await getSupabaseAdmin()
      .from("cars")
      .select("id");
    if (allCarsErr) {
      console.error("[repesca/image] read cars:", allCarsErr);
      return res.status(500).json({ error: "Failed to load catalog" });
    }
    const carId = resolveRealCarId(
      pseudoCarId,
      user.id,
      (allCarRows || []).map((c) => c.id)
    );
    if (!carId) {
      return res.status(400).json({ error: "Invalid carId" });
    }

    // Gate: ¿el usuario tiene una repesca activa hoy para ESE carId real?
    // Read con service_role (mismo motivo que en start/validate).
    const today = todayInMadrid();
    const { data: statsRow, error: statsErr } = await getSupabaseAdmin()
      .from("stats")
      .select("last_repesca_at, last_repesca_car_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (statsErr) {
      console.error("[repesca/image] read stats:", statsErr);
      return res.status(500).json({ error: "Failed to check repesca" });
    }
    const valid =
      statsRow?.last_repesca_at === today &&
      statsRow?.last_repesca_car_id === carId;
    if (!valid) {
      return res.status(403).json({ error: "Repesca not active for this car" });
    }

    // ¿Ha cerrado la partida el usuario para este coche? Si sí, le servimos
    // la imagen completa; si no, la crop'eamos server-side al 55% central
    // (igual que en daily-image durante "playing").
    const { data: guessRow } = await authClient
      .from("user_guesses")
      .select("status")
      .eq("user_id", user.id)
      .eq("car_id", carId)
      .eq("date", today)
      .maybeSingle();
    const isFinished =
      guessRow?.status === "won" || guessRow?.status === "lost";

    // Cargar URL real del CDN + zoom_base para este coche.
    const { data: row, error: fetchErr } = await getSupabaseAdmin()
      .from("cars")
      .select("image_url, zoom_base")
      .eq("id", carId)
      .single();
    if (fetchErr || !row?.image_url) {
      console.error("[repesca/image] read car:", fetchErr);
      return res.status(500).json({ error: "Failed to load car" });
    }
    const zoomBase = clampZoomBase(row.zoom_base);

    // Fetch server-side de los bytes y proxy al cliente.
    let upstream;
    try {
      upstream = await fetch(row.image_url);
    } catch (err) {
      console.error("[repesca/image] upstream fetch:", err);
      return res.status(502).json({ error: "Upstream image unavailable" });
    }
    if (!upstream.ok) {
      return res.status(502).json({ error: "Upstream image error" });
    }

    const originalContentType = upstream.headers.get("content-type") || "image/jpeg";
    const originalBuffer = Buffer.from(await upstream.arrayBuffer());

    let outBuffer = originalBuffer;
    let outContentType = originalContentType;

    // FORMATO: WebP en ambos casos (crop y revelado). Antes el crop salía en
    // JPEG q80, que se veía notablemente peor que el AVIF/WebP del juego
    // principal. Usamos WebP (no AVIF) porque la imagen viaja como blob y se
    // pinta en un <img> sin <picture> de fallback: AVIF rompería en Safari
    // < 16.4, mientras que WebP es seguro en todos los navegadores actuales.
    if (!isFinished) {
      // Durante la partida recortamos al cuadrado del último intento (el más
      // amplio), según el zoom_base del coche — mismo cálculo que daily-image.
      try {
        const meta = await sharp(originalBuffer).metadata();
        if (meta?.width && meta?.height) {
          const rotated90 = meta.orientation && meta.orientation >= 5;
          const W = rotated90 ? meta.height : meta.width;
          const H = rotated90 ? meta.width : meta.height;
          const minDim = Math.min(W, H);
          const size = Math.max(1, Math.round(minDim * cropPctForAttempt(ZOOM_ATTEMPTS, zoomBase)));
          const left = Math.max(0, Math.round((W - size) / 2));
          const top = Math.max(0, Math.round((H - size) / 2));
          outBuffer = await sharp(originalBuffer)
            .rotate()
            .extract({ left, top, width: size, height: size })
            .webp({ quality: 88, smartSubsample: true })
            .toBuffer();
          outContentType = "image/webp";
        }
      } catch (err) {
        // Si sharp falla, mejor no entregar la imagen completa por accidente.
        console.error("[repesca/image] sharp crop:", err?.message || err);
        return res.status(500).json({ error: "Image processing failed" });
      }
    } else {
      // Revelado completo: re-encode a WebP (orientación normalizada + menor
      // peso), para igualar la calidad/formato del juego principal.
      try {
        outBuffer = await sharp(originalBuffer)
          .rotate()
          .webp({ quality: 88, smartSubsample: true })
          .toBuffer();
        outContentType = "image/webp";
      } catch (err) {
        // Degradación segura: servimos el original sin bloquear el reveal.
        console.error("[repesca/image] sharp webp full:", err?.message || err);
      }
    }

    res.setHeader("Content-Type", outContentType);
    res.setHeader("Content-Length", String(outBuffer.length));
    // Cache PRIVADA (navegador del usuario, nunca CDN compartido — la
    // respuesta depende de user_guesses: cropped mientras juega, full al
    // terminar). Antes era `no-store`, que impedía cualquier cache y obligaba
    // a re-procesar sharp en cada carga. Ahora permitimos cache privada de
    // 5 min: el preload que dispara Garage.jsx durante el barajeo puebla
    // esta cache, y cuando /repesca monta y pide la MISMA url, es un hit
    // instantáneo (sin red, sin sharp).
    //
    // Anti-stale tras ganar: el cliente añade `&phase=playing|done` a la
    // URL. El server IGNORA ese param para decidir crop/full (eso lo dicta
    // user_guesses, no el cliente — no hay bypass posible), pero al cambiar
    // la query cambia la cache key: la imagen cropped (phase=playing) y la
    // full revelada (phase=done) viven en entradas distintas y no se pisan.
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("Content-Disposition", "inline");

    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).send(outBuffer);
  } catch (err) {
    console.error("[repesca/image] UNCAUGHT:", err && err.stack ? err.stack : err);
    await captureServerError(err, { endpoint: "repesca/image" });
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
