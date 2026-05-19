// api/daily-image.js
// Proxy de la imagen del coche del día. El cliente solo recibe los bytes;
// la URL real del CDN (que contenía marca-modelo-año en el filename) NUNCA
// se expone al navegador.
//
// Flujo:
//   1) Resolvemos el coche del día con pick_daily_car (service_role: la RPC
//      está revocada de anon/authenticated por hardening previo).
//   2) Leemos image_url de la fila (columna privilegiada).
//   3) Hacemos un fetch server-side al CDN.
//   4) Si el cliente pidió `?w` o `?f`, redimensionamos / recodificamos con
//      sharp. Si no, passthrough literal.
//
// Query params:
//   ?d=YYYY-MM-DD   → cache buster diario (no se lee aquí; es solo cache key).
//   ?v=<hash>       → hash corto de image_url (no se lee aquí; es solo cache
//                     key — invalida automáticamente cuando admin cambia la
//                     foto desde /admin/edit-car).
//   ?w=320|640|1280 → ancho objetivo. Allowlist estricta para evitar DoS por
//                     resize a tamaños absurdos.
//   ?f=avif|webp|jpeg → formato de salida. Allowlist estricta.
//
// Cache:
//   Cada combinación (d, v, w, f) tiene su propia entrada en el edge cache
//   de Vercel. El cost de sharp se paga una vez por entrada y región, y
//   luego durante 24 h se sirve desde el CDN sin tocar la función.

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { readAnonSession } from "./_lib/anon-session.js";
import { verifyRevealToken } from "./_lib/reveal-token.js";

// Allowlists. Cambiar aquí también requiere actualizar CarImage.jsx (los
// srcset del front), que es donde se decide qué tamaños se piden.
// 1920 quitado: en móvil/desktop normal nunca se pide y solo añadía una
// cache key más que calentar y otra ocasión de cold-start de sharp.
const ALLOWED_WIDTHS = new Set([640, 1280]);
const FORMAT_MIME = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
};

// Zoom levels y mapeo a porcentaje del crop centrado.
//
// El motor del juego trabajaba antes así: una imagen FULL del coche bajaba
// al navegador y el cliente aplicaba `transform: scale(3.5x → 1.8x)` CSS
// para "tapar" lo que el jugador todavía no se había ganado ver. Eso es
// puramente visual: el atacante con DevTools podía abrir Network → Preview
// y ver la imagen entera en dos clicks.
//
// Ahora el servidor RECORTA la imagen al área que el jugador legítimo
// estaría viendo en ese intento, antes de devolverla. La imagen completa
// nunca sale del servidor mientras el juego está activo.
//
// Los porcentajes son `1 / ZOOM_LEVEL`, exactamente:
//   z=1 (intento 1, zoom 3.5x) → 28.6% del lado menor centrado.
//   z=2 (intento 2, zoom 3.0x) → 33.3%.
//   z=3 (intento 3, zoom 2.7x) → 37.0%.
//   z=4 (intento 4, zoom 2.4x) → 41.7%.
//   z=5 (intento 5, zoom 1.8x) → 55.6%.
// Si no se pasa `z` o el valor está fuera del set, NO se aplica crop:
// devolvemos la imagen completa. El cliente solo debería pedir sin `z`
// cuando el juego ha terminado (status=won|lost) y queremos revelar.
const ALLOWED_Z = new Set([1, 2, 3, 4, 5]);
const Z_TO_CROP_PCT = {
  1: 0.286,
  2: 0.333,
  3: 0.370,
  4: 0.417,
  5: 0.556,
};

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// Si llega un Bearer, intentamos identificar al usuario para gatear el
// reveal a su `user_guesses.status`. Es opcional: el flujo normal de
// reveal pasa por el revealToken firmado, pero este check es defensivo
// para clientes que aún no tengan token (cache antigua, refresh raro).
async function tryReadUserStatus(req, carId, today) {
  const auth = req.headers?.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  if (!token || !SUPABASE_ANON_KEY) return null;
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: u } = await client.auth.getUser();
    if (!u?.user) return null;
    const { data: row } = await client
      .from("user_guesses")
      .select("status")
      .eq("user_id", u.user.id)
      .eq("car_id", carId)
      .eq("date", today)
      .maybeSingle();
    return row?.status || null;
  } catch (err) {
    console.error("[daily-image] tryReadUserStatus:", err?.message || err);
    return null;
  }
}

function todayInMadrid() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ message: "Only GET allowed" });
  }

  if (!supabaseAdmin) {
    console.error("[daily-image] missing SUPABASE_SERVICE_ROLE_KEY");
    return res.status(500).json({ message: "Server misconfigured" });
  }

  const today = todayInMadrid();

  // 1) Coche del día.
  const { data: carId, error: rpcErr } = await supabaseAdmin.rpc(
    "pick_daily_car",
    { p_date: today }
  );
  if (rpcErr || !carId) {
    console.error("[daily-image] pick_daily_car:", rpcErr);
    return res.status(500).json({ message: "Failed to pick daily car" });
  }

  // 2) URL real del CDN. Nunca sale de este proceso.
  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("cars")
    .select("image_url")
    .eq("id", carId)
    .single();
  if (fetchErr || !row?.image_url) {
    console.error("[daily-image] fetch car:", fetchErr);
    return res.status(500).json({ message: "Failed to load daily car" });
  }

  // 3) Validamos params de procesamiento. Las allowlists son estrictas: si
  //    el cliente pide algo fuera del set, lo ignoramos (no devolvemos 400)
  //    para que un visitante con un srcset cacheado obsoleto no rompa.
  const wRaw = Number(req.query?.w);
  const wantedWidth =
    Number.isFinite(wRaw) && ALLOWED_WIDTHS.has(wRaw) ? wRaw : null;

  const fRaw = String(req.query?.f || "").toLowerCase();
  const wantedFormat = fRaw in FORMAT_MIME ? fRaw : null;

  const zRaw = Number(req.query?.z);
  const zRequested =
    Number.isFinite(zRaw) && ALLOWED_Z.has(zRaw) ? zRaw : null;

  // ---- Gateo del REVEAL (imagen completa) ------------------------------
  // Antes, "sin z" significaba "imagen completa" — un cheater abría
  // DevTools, copiaba la URL, quitaba `&z=5` y veía el coche entero. Ahora
  // exigimos prueba server-verificable de que el visitante ha terminado
  // la partida. Tres vías equivalentes:
  //   (a) ?t=<revealToken> firmado por hoy (lo emite get-daily-car y
  //       validate-guess cuando aplican).
  //   (b) Bearer del usuario y user_guesses.status ∈ {won, lost}.
  //   (c) Cookie anónima firmada con s ∈ {won, lost}.
  // Si NINGUNA aplica, forzamos el crop más amplio que un jugador
  // legítimo podría ver durante la partida (z=5 = 55,6% central).
  let canReveal = false;

  const tParam = typeof req.query?.t === "string" ? req.query.t : "";
  if (tParam) {
    const tokenDate = verifyRevealToken(tParam);
    if (tokenDate === today) canReveal = true;
  }

  if (!canReveal) {
    const userStatus = await tryReadUserStatus(req, carId, today);
    if (userStatus === "won" || userStatus === "lost") canReveal = true;
  }

  if (!canReveal) {
    const anon = readAnonSession(req);
    if (anon && anon.d === today && (anon.s === "won" || anon.s === "lost")) {
      canReveal = true;
    }
  }

  // Decisión final del crop:
  //   - canReveal=true  → respetamos lo que el cliente pidió (sin z = full,
  //                       con z = un crop concreto si lo quiere por motivos
  //                       de bandwidth — raro, pero válido).
  //   - canReveal=false → SIEMPRE crop. Si el cliente mandó un z válido,
  //                       lo usamos; si no, fallback a z=5.
  const wantedZ = canReveal ? zRequested : zRequested ?? 5;

  // 4) Fetch server-side de los bytes. Si el CDN falla, propagamos el status
  //    para que el cliente sepa que no es un error de nuestra app.
  let upstream;
  try {
    upstream = await fetch(row.image_url);
  } catch (err) {
    console.error("[daily-image] upstream fetch:", err);
    return res.status(502).json({ message: "Upstream image unavailable" });
  }

  if (!upstream.ok) {
    console.error("[daily-image] upstream status:", upstream.status);
    return res.status(502).json({ message: "Upstream image error" });
  }

  const originalContentType =
    upstream.headers.get("content-type") || "image/jpeg";
  const originalBuffer = Buffer.from(await upstream.arrayBuffer());

  // 5) Procesamiento. Si el cliente pidió tamaño o formato, pasamos por
  //    sharp. Si no, passthrough (mantenemos backward-compat con cualquier
  //    enlace antiguo que llegue sin params, p.ej. tarjetas OG cacheadas).
  let outBuffer = originalBuffer;
  let outContentType = originalContentType;

  if (wantedWidth !== null || wantedFormat !== null || wantedZ !== null) {
    try {
      let pipeline = sharp(originalBuffer).rotate(); // rotate() respeta EXIF

      if (wantedZ !== null) {
        // Crop centrado al área correspondiente al zoom-level del intento.
        // Importante: sharp.metadata() devuelve las dimensiones FÍSICAS del
        // fichero, antes de aplicar EXIF orientation. Pero el pipeline ya
        // hizo .rotate() arriba, así que la imagen efectiva puede estar
        // girada 90/270 respecto a lo que dice meta.width/meta.height.
        // Si orientation ≥ 5, las dimensiones reales están intercambiadas.
        const meta = await sharp(originalBuffer).metadata();
        if (meta?.width && meta?.height) {
          const rotated90 = meta.orientation && meta.orientation >= 5;
          const W = rotated90 ? meta.height : meta.width;
          const H = rotated90 ? meta.width : meta.height;
          // Cuadrado centrado, lado = min(W,H) × cropPct. Cuadrado porque
          // el container del juego es 1:1; así el resultado entra exacto
          // sin que el cliente tenga que recortar nada con object-cover.
          const minDim = Math.min(W, H);
          const size = Math.max(1, Math.round(minDim * Z_TO_CROP_PCT[wantedZ]));
          const left = Math.max(0, Math.round((W - size) / 2));
          const top = Math.max(0, Math.round((H - size) / 2));
          pipeline = pipeline.extract({ left, top, width: size, height: size });
        }
      }

      if (wantedWidth !== null) {
        pipeline = pipeline.resize(wantedWidth, null, {
          fit: "inside",
          withoutEnlargement: true,
        });
      }
      if (wantedFormat === "avif") {
        // effort 2: encoda ~3× más rápido que effort 4 a cambio de archivos
        // ~10-15% más grandes (imperceptible para fotos de coches). El cold
        // start de la función Vercel pasa de 3-8 s a 1-2 s, lo que evita
        // que el watchdog del cliente (8 s) dispare el fallback a JPEG.
        pipeline = pipeline.avif({ quality: 50, effort: 2 });
      } else if (wantedFormat === "webp") {
        pipeline = pipeline.webp({ quality: 75 });
      } else if (wantedFormat === "jpeg") {
        pipeline = pipeline.jpeg({
          quality: 80,
          mozjpeg: true,
          progressive: true,
        });
      }
      outBuffer = await pipeline.toBuffer();
      if (wantedFormat !== null) outContentType = FORMAT_MIME[wantedFormat];
    } catch (err) {
      // Si sharp falla por cualquier motivo (input corrupto, OOM, formato
      // raro), seguimos sirviendo el original. Mejor entregar una imagen
      // grande que ningún LCP.
      console.error("[daily-image] sharp pipeline:", err?.message || err);
      outBuffer = originalBuffer;
      outContentType = originalContentType;
    }
  }

  // Cache:
  //   - Si el cliente pasó un revealToken válido (?t=...), la URL incluye
  //     ese token y es única para "reveal de hoy". Misma respuesta para
  //     todos los que lo presenten → CDN-cacheable 24 h.
  //   - Si la cache key es la URL "sin t" pero entregamos imagen completa
  //     porque el usuario está logueado-con-win o tiene cookie won, NO
  //     podemos cachear públicamente: la siguiente request anónima a esa
  //     misma URL recibiría la imagen completa del cache → fuga total.
  //     Marcamos no-store.
  //   - El resto (crop forzado a z=5) es público y determinista, sin
  //     leak: el crop es lo mismo que ve cualquier jugador legítimo.
  const cacheable = !canReveal || Boolean(tParam);
  res.setHeader("Content-Type", outContentType);
  res.setHeader("Content-Length", String(outBuffer.length));
  res.setHeader(
    "Cache-Control",
    cacheable
      ? "public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400, immutable"
      : "private, no-store"
  );
  // Por si acaso algún proxy intermedio mira el Content-Disposition:
  // forzamos inline sin filename, evitando filtrar el original del CDN.
  res.setHeader("Content-Disposition", "inline");

  if (req.method === "HEAD") {
    return res.status(200).end();
  }
  return res.status(200).send(outBuffer);
}
