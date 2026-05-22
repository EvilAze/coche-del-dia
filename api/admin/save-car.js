// api/admin/save-car.js
// CRUD unificado de la tabla `cars`. Acepta GET y POST para no consumir un
// slot de función serverless extra (plan Hobby de Vercel: 12 max). Antes el
// GET vivía en /api/admin/get-car.js — fusionado aquí para liberar slot.
//
// Métodos:
//   - GET ?id=<uuid>        → devuelve la fila completa del coche (incluye
//                              image_url, que está revocada para anon/auth
//                              y solo es legible vía service_role).
//   - POST sin `id` en body → INSERT (alta). Requiere marca, modelo, anio,
//                              pais, image_url.
//   - POST con `id` válido  → UPDATE parcial. Solo se aplican los campos
//                              presentes en el body — útil para "tocar solo
//                              la descripción" sin pisar el resto.
//
// Body POST JSON:
//   {
//     id?:             uuid                       // ausente = alta, presente = update
//     marca, modelo, anio, pais,                  // requeridos en alta, opcionales en update
//     description?, description_en?,              // siempre opcionales
//     image_url                                   // requerido en alta, opcional en update
//   }
//
// Patrón de seguridad: misma whitelist de email para todas las operaciones.
// Service-role bypassea RLS. El cliente sube la imagen al bucket público
// `cars_images` por su cuenta y nos manda la URL ya resuelta.

import { generateBlurData } from "../_lib/blur-data.js";
import { supabaseAdmin } from "../_lib/supabase.js";
import { requireAdmin } from "../_lib/auth.js";
import { parseBody, methodGuard } from "../_lib/http.js";

const CURRENT_YEAR = new Date().getFullYear();
const MAX_DESCRIPTION_LEN = 600;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    focus_x: typeof row.focus_x === "number" ? row.focus_x : 0.5,
    focus_y: typeof row.focus_y === "number" ? row.focus_y : 0.5,
  };
}

// Validador compartido para focus_x / focus_y. Devuelve un número en [0,1]
// o null si el valor no es válido. Permite null/undefined → null (no se
// toca la columna en update; en insert deja que la BD aplique el default).
function parseFocus(value) {
  if (value === undefined || value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined; // sentinel para "inválido"
  if (n < 0 || n > 1) return undefined;
  return n;
}

export default async function handler(req, res) {
  if (methodGuard(req, res, ["GET", "POST", "DELETE"])) return;

  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: "Server misconfigured" });
    }

    // Identidad + whitelist (compartido entre lectura, alta y update).
    const { error: authError } = await requireAdmin(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    // ====================== GET (lectura por id) ======================
    // Antes vivía en /api/admin/get-car.js. Fusionado aquí para liberar slot.
    if (req.method === "GET") {
      const idQ = typeof req.query?.id === "string" ? req.query.id.trim() : "";
      if (!idQ || !UUID_RE.test(idQ)) {
        return res.status(400).json({ message: "Invalid id" });
      }
      const { data, error } = await supabaseAdmin
        .from("cars")
        .select("id, make, model, year, pais, description, description_en, image_url, focus_x, focus_y")
        .eq("id", idQ)
        .maybeSingle();
      if (error) {
        console.error("[admin/save-car get]", error);
        return res.status(500).json({ message: "Read failed" });
      }
      if (!data) return res.status(404).json({ message: "Not found" });
      return res.status(200).json(shapeCarResponse(data));
    }

    // ====================== DELETE ======================
    // Solo permite borrar coches que nunca han aparecido en `daily_cars`
    // (ni pasados ni futuros) para no romper el historial ni el calendario.
    if (req.method === "DELETE") {
      const idQ = typeof req.query?.id === "string" ? req.query.id.trim() : "";
      if (!idQ || !UUID_RE.test(idQ)) {
        return res.status(400).json({ error: "Invalid id" });
      }

      // Comprobamos si el coche está asignado en alguna fecha (pasada o futura).
      const { data: used, error: usedError } = await supabaseAdmin
        .from("daily_cars")
        .select("date")
        .eq("car_id", idQ)
        .limit(1)
        .maybeSingle();
      if (usedError) {
        console.error("[admin/save-car delete] check daily_cars:", usedError);
        return res.status(500).json({ error: "Delete check failed" });
      }
      if (used) {
        return res.status(409).json({
          error: "No se puede borrar: el coche tiene asignaciones en el calendario.",
        });
      }

      const { error: delError } = await supabaseAdmin
        .from("cars")
        .delete()
        .eq("id", idQ);
      if (delError) {
        console.error("[admin/save-car delete]", delError);
        return res.status(500).json({ error: "Delete failed", detail: delError.message });
      }

      return res.status(200).json({ ok: true });
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
      // focus_x / focus_y — punto del crop del zoom. Solo aplicamos si
      // llegan en el body y son válidos. parseFocus devuelve `undefined`
      // cuando el valor está fuera de rango o no es numérico — en ese caso
      // 400. `null` significa "no presente", lo ignoramos.
      if ("focus_x" in body) {
        const fx = parseFocus(body.focus_x);
        if (fx === undefined) {
          return res.status(400).json({ error: "focus_x fuera de [0, 1]" });
        }
        if (fx !== null) patch.focus_x = fx;
      }
      if ("focus_y" in body) {
        const fy = parseFocus(body.focus_y);
        if (fy === undefined) {
          return res.status(400).json({ error: "focus_y fuera de [0, 1]" });
        }
        if (fy !== null) patch.focus_y = fy;
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "Nothing to update" });
      }

      const { data, error } = await supabaseAdmin
        .from("cars")
        .update(patch)
        .eq("id", idRaw)
        .select("id, make, model, year, pais, description, description_en, image_url, focus_x, focus_y")
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

    // focus_x / focus_y opcionales en el alta. Si no vienen, la BD aplica
    // el DEFAULT 0.5 → comportamiento histórico (crop centrado).
    const focusXIn = parseFocus(body.focus_x);
    const focusYIn = parseFocus(body.focus_y);
    if (focusXIn === undefined) {
      return res.status(400).json({ error: "focus_x fuera de [0, 1]" });
    }
    if (focusYIn === undefined) {
      return res.status(400).json({ error: "focus_y fuera de [0, 1]" });
    }

    // LQIP generado durante el alta para que el coche nazca con su
    // blur_data listo. Si falla, seguimos sin LQIP en lugar de romper.
    const blurData = await generateBlurData(imageUrl);

    const insertRow = {
      make: marca,
      model: modelo,
      year: anioNum,
      pais,
      description: description ? description : null,
      description_en: descriptionEn ? descriptionEn : null,
      image_url: imageUrl,
      blur_data: blurData,
    };
    if (focusXIn !== null) insertRow.focus_x = focusXIn;
    if (focusYIn !== null) insertRow.focus_y = focusYIn;

    const { data, error } = await supabaseAdmin
      .from("cars")
      .insert(insertRow)
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
