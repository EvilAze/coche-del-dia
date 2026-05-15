// api/repesca/image.js
// Proxy de la imagen del coche en repesca. Mismo patrón que /api/daily-image
// pero pinned a un carId concreto + gateado por la repesca activa del
// usuario: solo sirve los bytes si el usuario tiene una repesca ACTIVA HOY
// para ese carId (es decir, ya pasó por /api/repesca/start).
//
// Esto evita que cualquier usuario logueado pueda llamar /repesca/image?
// carId=<X> y obtener la imagen de un coche al que aún no juega.

import { createClient } from "@supabase/supabase-js";
import { resolveRealCarId } from "../_lib/repesca-token.js";

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

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await upstream.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(buffer.length));
    // Cache corta (60s) por si el admin hot-swappea la imagen del coche
    // a mitad de la repesca. Igual que /api/daily-image.
    res.setHeader(
      "Cache-Control",
      "private, max-age=60, stale-while-revalidate=30"
    );
    res.setHeader("Content-Disposition", "inline");

    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).send(buffer);
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
