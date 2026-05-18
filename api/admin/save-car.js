// api/admin/save-car.js
// CRUD unificado de la tabla `cars`. Reemplaza a los anteriores
// /api/admin/add-car y /api/admin/update-car, fusionados para no superar
// el límite de 12 funciones serverless del plan Hobby de Vercel.
//
// Modo se decide por presencia de `id` en el body:
//   - Sin `id`              → INSERT (alta). Requiere todos los campos
//                              obligatorios (marca, modelo, anio, pais,
//                              image_url).
//   - Con `id` válido (UUID) → UPDATE parcial. Solo se aplican los campos
//                              presentes en el body — útil para "tocar solo
//                              la descripción" sin pisar el resto.
//
// Body JSON:
//   {
//     id?:             uuid                       // ausente = alta, presente = update
//     marca, modelo, anio, pais,                  // requeridos en alta, opcionales en update
//     description?, description_en?,              // siempre opcionales
//     image_url                                   // requerido en alta, opcional en update
//   }
//
// Patrón de seguridad: misma whitelist de email para ambas operaciones.
// Service-role bypassea RLS. El cliente sube la imagen al bucket público
// `cars_images` por su cuenta y nos manda la URL ya resuelta.

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

const CURRENT_YEAR = new Date().getFullYear();
const MAX_DESCRIPTION_LEN = 600;
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

// Forma de respuesta común para ambas operaciones — el cliente no tiene
// que ramificar el parseo entre alta y update.
function shapeCarResponse(row) {
  return {
    id: row.id,
    marca: row.make,
    modelo: row.model,
    anio: row.year,
    pais: row.pais,
    description: row.description ?? null,
    description_en: row.description_en ?? null,
    img: row.image_url,
  };
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

    // 1) Identidad + whitelist (compartido entre alta y update).
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

    const body = parseBody(req);
    const idRaw = typeof body.id === "string" ? body.id.trim() : "";
    const isUpdate = idRaw !== "";

    // ====================== UPDATE ======================
    if (isUpdate) {
      if (!UUID_RE.test(idRaw)) {
        return res.status(400).json({ error: "Invalid id" });
      }

      // Patch defensivo: solo lo que llegue en el body. Esto permite
      // PATCH-style updates ("solo la descripción") sin pisar el resto.
      const patch = {};
      if (typeof body.marca === "string") patch.make = body.marca.trim();
      if (typeof body.modelo === "string") patch.model = body.modelo.trim();
      if (body.anio !== undefined && body.anio !== null) {
        const n = Number(body.anio);
        if (!Number.isInteger(n) || n < 1885 || n > CURRENT_YEAR + 1) {
          return res.status(400).json({ error: "Invalid anio" });
        }
        patch.year = n;
      }
      if (typeof body.pais === "string") patch.pais = body.pais.trim();
      if ("description" in body) {
        const d = typeof body.description === "string" ? body.description.trim() : "";
        if (d.length > MAX_DESCRIPTION_LEN) {
          return res.status(400).json({
            error: `Descripción supera ${MAX_DESCRIPTION_LEN} caracteres`,
          });
        }
        patch.description = d ? d : null;
      }
      if ("description_en" in body) {
        const d = typeof body.description_en === "string" ? body.description_en.trim() : "";
        if (d.length > MAX_DESCRIPTION_LEN) {
          return res.status(400).json({
            error: `Descripción EN supera ${MAX_DESCRIPTION_LEN} caracteres`,
          });
        }
        patch.description_en = d ? d : null;
      }
      if (typeof body.image_url === "string" && body.image_url.startsWith("http")) {
        patch.image_url = body.image_url;
        // Si la foto cambia, regeneramos el LQIP. Si falla, persistimos
        // null y el front cae al skeleton hasta que se reedite — preferible
        // a romper el guardado.
        patch.blur_data = await generateBlurData(body.image_url);
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "Nothing to update" });
      }

      const { data, error } = await supabaseAdmin
        .from("cars")
        .update(patch)
        .eq("id", idRaw)
        .select("id, make, model, year, pais, description, description_en, image_url")
        .maybeSingle();
      if (error) {
        console.error("[admin/save-car update]", error);
        return res.status(500).json({ error: "Update failed", detail: error.message });
      }
      if (!data) {
        return res.status(404).json({ error: "Not found" });
      }

      return res.status(200).json({ ok: true, car: shapeCarResponse(data) });
    }

    // ====================== INSERT ======================
    const marca = typeof body.marca === "string" ? body.marca.trim() : "";
    const modelo = typeof body.modelo === "string" ? body.modelo.trim() : "";
    const pais = typeof body.pais === "string" ? body.pais.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    const descriptionEn =
      typeof body.description_en === "string" ? body.description_en.trim() : "";
    const imageUrl =
      typeof body.image_url === "string" ? body.image_url.trim() : "";

    if (!marca) return res.status(400).json({ error: "Marca requerida" });
    if (!modelo) return res.status(400).json({ error: "Modelo requerido" });
    if (!pais) return res.status(400).json({ error: "País requerido" });

    const anioNum = Number(body.anio);
    if (!Number.isInteger(anioNum) || anioNum < 1885 || anioNum > CURRENT_YEAR + 1) {
      return res.status(400).json({
        error: `Año fuera de rango (debe estar entre 1885 y ${CURRENT_YEAR + 1})`,
      });
    }

    if (!imageUrl || !imageUrl.startsWith("http")) {
      return res.status(400).json({ error: "image_url inválida" });
    }

    if (description.length > MAX_DESCRIPTION_LEN) {
      return res.status(400).json({
        error: `Descripción supera ${MAX_DESCRIPTION_LEN} caracteres`,
      });
    }
    if (descriptionEn.length > MAX_DESCRIPTION_LEN) {
      return res.status(400).json({
        error: `Descripción EN supera ${MAX_DESCRIPTION_LEN} caracteres`,
      });
    }

    // LQIP generado durante el alta para que el coche nazca con su
    // blur_data listo. Si falla, seguimos sin LQIP en lugar de romper.
    const blurData = await generateBlurData(imageUrl);

    const { data, error } = await supabaseAdmin
      .from("cars")
      .insert({
        make: marca,
        model: modelo,
        year: anioNum,
        pais,
        description: description ? description : null,
        description_en: descriptionEn ? descriptionEn : null,
        image_url: imageUrl,
        blur_data: blurData,
      })
      .select("id, make, model, year, pais, description, description_en, image_url")
      .maybeSingle();

    if (error) {
      console.error("[admin/save-car insert]", error);
      return res.status(500).json({
        error: "Insert failed",
        detail: error.message,
      });
    }

    return res.status(200).json({ ok: true, car: shapeCarResponse(data) });
  } catch (err) {
    console.error("[admin/save-car] UNCAUGHT:", err && err.stack ? err.stack : err);
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
