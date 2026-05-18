// api/admin/add-car.js
// Inserta una fila nueva en `cars`. Solo accesible para emails de la
// whitelist. Patrón idéntico al de /api/admin/update-car:
//
//   - El cliente sube la imagen al bucket cars_images por su cuenta
//     (storage policies separadas — ese bucket sigue siendo público) y
//     nos manda la image_url ya resuelta.
//   - Aquí validamos identidad + whitelist y hacemos INSERT con
//     service_role, que bypassea RLS.
//
// Body JSON:
//   { marca, modelo, anio, pais, description?, image_url }
//
// Por qué server-side y no .from('cars').insert() desde el navegador:
// La policy histórica "Subida de coches" sobre `cars` aceptaba INSERT a
// cualquier `authenticated` (no solo al admin). Pasar la escritura al
// servidor + revocar grants permite cerrar esa puerta sin romper este
// formulario.

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

    // 1) Verifica identidad y whitelist (mismo patrón que update-car).
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

    // 2) Body + validación. Mismas reglas que el form cliente para evitar
    //    divergencia (si más adelante se relajan, ambas en este endpoint).
    const body = parseBody(req);
    const marca = typeof body.marca === "string" ? body.marca.trim() : "";
    const modelo = typeof body.modelo === "string" ? body.modelo.trim() : "";
    const pais = typeof body.pais === "string" ? body.pais.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    // description_en es opcional: si el admin no lo aporta o viene vacío,
    // guardamos NULL y el frontend hará fallback al español.
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

    // 3) LQIP. Generamos el placeholder DURANTE el alta para que el coche
    //    nazca con su blur_data ya listo; así el día que sea coche del día,
    //    el cliente recibe la data URI inline y no se ve el flash gris. Si
    //    falla (foto inaccesible, formato raro, etc.), seguimos sin LQIP en
    //    lugar de romper el alta — el script de migración lo regenera más
    //    tarde, o el admin lo arregla reeditando la foto.
    const blurData = await generateBlurData(imageUrl);

    // 4) INSERT con service_role (bypassea RLS).
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
      console.error("[admin/add-car]", error);
      return res.status(500).json({
        error: "Insert failed",
        detail: error.message,
      });
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
        description_en: data.description_en ?? null,
        img: data.image_url,
      },
    });
  } catch (err) {
    console.error("[admin/add-car] UNCAUGHT:", err && err.stack ? err.stack : err);
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
