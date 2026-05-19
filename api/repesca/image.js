// api/repesca/image.js
// Proxy de la imagen del coche en repesca. Mismo patrón que /api/daily-image
// pero pinned a un carId concreto + gateado por la repesca activa del
// usuario: solo sirve los bytes si el usuario tiene una repesca ACTIVA HOY
// para ese carId (es decir, ya pasó por /api/repesca/start).
//
// Esto evita que cualquier usuario logueado pueda llamar /repesca/image?
// carId=<X> y obtener la imagen de un coche al que aún no juega.

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { resolveRealCarId } from "../_lib/repesca-token.js";

// Mismo crop fijo que /api/daily-image durante la partida: 55,6% central.
// El cliente termina de "cerrar" el zoom por CSS sobre este 55%. Antes
// servíamos la imagen ENTERA en repesca y el zoom era 100% client-side —
// con DevTools veías el coche desnudo nada más arrancar.
const CROP_PCT_PLAYING = 0.556;

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function todayInMadrid() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function extractAccessToken(req) {
  const header = req.headers?.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

async function authClientAndUser(accessToken) {
  if (!accessToken) return { client: null, user: null };
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) return { client: null, user: null };
    return { client, user: data.user };
  } catch (err) {
    console.error("[repesca/image] authClientAndUser:", err);
    return { client: null, user: null };
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const accessToken = extractAccessToken(req);
    const { client: authClient, user } = await authClientAndUser(accessToken);
    if (!user || !authClient) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // El cliente nos pasa el PSEUDO (lo recibió de /api/garage). Lo
    // resolvemos al cars.id real antes de cualquier otra operación.
    const pseudoCarId = String(req.query?.carId || "").trim();
    if (!pseudoCarId) {
      return res.status(400).json({ error: "Missing carId" });
    }
    const { data: allCarRows, error: allCarsErr } = await supabaseAdmin
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
    const { data: statsRow, error: statsErr } = await supabaseAdmin
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

    // Cargar URL real del CDN para este coche.
    const { data: row, error: fetchErr } = await supabaseAdmin
      .from("cars")
      .select("image_url")
      .eq("id", carId)
      .single();
    if (fetchErr || !row?.image_url) {
      console.error("[repesca/image] read car:", fetchErr);
      return res.status(500).json({ error: "Failed to load car" });
    }

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

    // Durante la partida (NO terminada), recortamos a un cuadrado central
    // del 55,6% del lado menor — mismo cálculo que daily-image z=5.
    if (!isFinished) {
      try {
        const meta = await sharp(originalBuffer).metadata();
        if (meta?.width && meta?.height) {
          const rotated90 = meta.orientation && meta.orientation >= 5;
          const W = rotated90 ? meta.height : meta.width;
          const H = rotated90 ? meta.width : meta.height;
          const minDim = Math.min(W, H);
          const size = Math.max(1, Math.round(minDim * CROP_PCT_PLAYING));
          const left = Math.max(0, Math.round((W - size) / 2));
          const top = Math.max(0, Math.round((H - size) / 2));
          outBuffer = await sharp(originalBuffer)
            .rotate()
            .extract({ left, top, width: size, height: size })
            .jpeg({ quality: 80, mozjpeg: true })
            .toBuffer();
          outContentType = "image/jpeg";
        }
      } catch (err) {
        // Si sharp falla, mejor no entregar la imagen completa por accidente.
        console.error("[repesca/image] sharp crop:", err?.message || err);
        return res.status(500).json({ error: "Image processing failed" });
      }
    }

    res.setHeader("Content-Type", outContentType);
    res.setHeader("Content-Length", String(outBuffer.length));
    // Cache PRIVADA y corta: la respuesta depende del estado del usuario
    // (cropped vs full según user_guesses), así que NO debe cruzarse entre
    // usuarios en ningún CDN compartido. Antes era una imagen anónimamente
    // pública — ahora es per-usuario.
    res.setHeader(
      "Cache-Control",
      "private, max-age=30, no-store"
    );
    res.setHeader("Content-Disposition", "inline");

    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).send(outBuffer);
  } catch (err) {
    console.error("[repesca/image] UNCAUGHT:", err && err.stack ? err.stack : err);
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
