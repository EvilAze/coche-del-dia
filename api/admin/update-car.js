// api/admin/update-car.js
// Actualiza una fila de `cars`. Solo accesible para emails de la whitelist.
//
// Patrón idéntico al de /api/admin/get-car: el cliente sube la imagen al
// bucket por su cuenta (si la cambia) y nos manda la nueva URL; aquí nos
// limitamos a validar y hacer UPDATE con service_role.
//
// Body JSON:
//   {
//     id: uuid,
//     marca, modelo, anio, pais, description,   // todos opcionales
//     image_url                                   // opcional, solo si cambió
//   }

import { createClient } from "@supabase/supabase-js";
import { generateBlurData } from "../_lib/blur-data.js";

const ADMIN_EMAILS = ["ievilaze@gmail.com"];

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

function extractAccessToken(req) {
  const header = req.headers?.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

function parseBody(req) {
  const raw = req.body;
  if (raw == null) return {};
  if (typeof raw === "object" && !Buffer.isBuffer(raw)) return raw;
  if (Buffer.isBuffer(raw)) {
    try { return JSON.parse(raw.toString("utf8")); } catch { return {}; }
  }
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const accessToken = extractAccessToken(req);
    if (!accessToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // 1) Verifica identidad y whitelist.
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser();
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const email = (userData.user.email || "").toLowerCase();
    if (!ADMIN_EMAILS.includes(email)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // 2) Body.
    const body = parseBody(req);
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id || !UUID_RE.test(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    // 3) Construimos el patch defensivamente: solo incluimos columnas que
    //    han llegado en el body. Esto permite "tocar solo la descripción"
    //    sin pisar el resto.
    const patch = {};
    if (typeof body.marca === "string") patch.make = body.marca.trim();
    if (typeof body.modelo === "string") patch.model = body.modelo.trim();
    if (body.anio !== undefined && body.anio !== null) {
      const n = Number(body.anio);
      if (!Number.isInteger(n) || n < 1885 || n > new Date().getFullYear() + 1) {
        return res.status(400).json({ error: "Invalid anio" });
      }
      patch.year = n;
    }
    if (typeof body.pais === "string") patch.pais = body.pais.trim();
    if ("description" in body) {
      const d = typeof body.description === "string" ? body.description.trim() : "";
      patch.description = d ? d : null;
    }
    if (typeof body.image_url === "string" && body.image_url.startsWith("http")) {
      patch.image_url = body.image_url;
      // Si el admin cambia la foto, regeneramos el LQIP. Si falla por algún
      // motivo (CDN frío, imagen rara), persistimos null y el front cae al
      // skeleton gris hasta que se reedite. Es preferible a romper el guardado.
      patch.blur_data = await generateBlurData(body.image_url);
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    // 4) UPDATE con service_role.
    const { data, error } = await supabaseAdmin
      .from("cars")
      .update(patch)
      .eq("id", id)
      .select("id, make, model, year, pais, description, image_url")
      .maybeSingle();
    if (error) {
      console.error("[admin/update-car]", error);
      return res.status(500).json({ error: "Update failed", detail: error.message });
    }
    if (!data) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.status(200).json({
      ok: true,
      car: {
        id: data.id,
        marca: data.make,
        modelo: data.model,
        anio: data.year,
        pais: data.pais,
        description: data.description ?? null,
        img: data.image_url,
      },
    });
  } catch (err) {
    console.error("[admin/update-car] UNCAUGHT:", err && err.stack ? err.stack : err);
    return res.status(500).json({
      error: "Internal error",
      detail: process.env.NODE_ENV === "production" ? undefined : String(err?.message || err),
    });
  }
}
