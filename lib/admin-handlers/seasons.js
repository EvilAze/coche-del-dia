// lib/admin-handlers/seasons.js
// CRUD de Temporadas Temáticas para el panel admin: crear/editar periodos con
// antelación y su temática (label es/en). Escribe con service_role (la tabla
// `seasons` es de lectura pública pero solo el servicio escribe). Gate:
// requireAdmin (whitelist por email), igual que el resto de handlers admin.
//
// Métodos (todos bajo /api/admin/seasons vía el dispatcher [...slug].js):
//   GET    → lista todas las temporadas (más recientes primero).
//   POST   → upsert. Body { id?, number, label_es, label_en, starts_at, ends_at }.
//            Sin id = alta; con id = edición.
//   DELETE → borra por id (body { id } o ?id=). Cascada a season_podium.
//
// El no-solape lo garantiza el constraint gist `seasons_no_overlap` en la BD;
// aquí traducimos ese error a un 409 legible en vez de un 500 opaco.

import { getSupabaseAdmin, getMissingAdminEnvs } from "../../api/_lib/supabase.js";
import { requireAdmin } from "../../api/_lib/auth.js";
import { parseBody, methodGuard } from "../../api/_lib/http.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

export default async function handler(req, res) {
  if (methodGuard(req, res, ["GET", "POST", "DELETE"])) return;

  try {
    if (!getSupabaseAdmin()) {
      console.error(`[admin/seasons] missing env vars: ${getMissingAdminEnvs().join(", ")}`);
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const { error: authError } = await requireAdmin(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    if (req.method === "GET") return handleGet(req, res);
    if (req.method === "POST") return handleUpsert(req, res);
    return handleDelete(req, res);
  } catch (err) {
    console.error("[admin/seasons] UNCAUGHT:", err?.stack || err);
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production" ? undefined : String(err?.message || err),
    });
  }
}

async function handleGet(req, res) {
  const { data, error } = await getSupabaseAdmin()
    .from("seasons")
    .select("id, number, label_es, label_en, starts_at, ends_at, closed_at")
    .order("starts_at", { ascending: false });
  if (error) {
    console.error("[admin/seasons] list:", error);
    return res.status(500).json({ error: "Failed to read seasons" });
  }
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ seasons: data || [] });
}

// Validación mínima; el no-solape lo hace la BD (ver handleUpsert).
function validateBody(body) {
  const number = Number(body.number);
  const labelEs = cleanStr(body.label_es);
  const labelEn = cleanStr(body.label_en);
  const startsAt = cleanStr(body.starts_at);
  const endsAt = cleanStr(body.ends_at);

  if (!Number.isInteger(number) || number < 1)
    return "El número de temporada debe ser un entero ≥ 1.";
  if (!labelEs) return "Falta la temática en español.";
  if (!labelEn) return "Falta la temática en inglés.";
  if (!DATE_RE.test(startsAt)) return "Fecha de inicio inválida (YYYY-MM-DD).";
  if (!DATE_RE.test(endsAt)) return "Fecha de fin inválida (YYYY-MM-DD).";
  if (endsAt < startsAt) return "La fecha de fin no puede ser anterior al inicio.";
  return null;
}

async function handleUpsert(req, res) {
  const body = parseBody(req) || {};
  const err = validateBody(body);
  if (err) return res.status(400).json({ error: err });

  const row = {
    number: Number(body.number),
    label_es: cleanStr(body.label_es),
    label_en: cleanStr(body.label_en),
    starts_at: cleanStr(body.starts_at),
    ends_at: cleanStr(body.ends_at),
  };

  const id = cleanStr(body.id);
  const db = getSupabaseAdmin();
  const query = id
    ? db.from("seasons").update(row).eq("id", id).select().single()
    : db.from("seasons").insert(row).select().single();

  const { data, error } = await query;
  if (error) {
    // 23P01 = exclusion_violation (constraint seasons_no_overlap): rango solapado.
    const blob = `${error.code || ""} ${error.message || ""} ${error.details || ""}`.toLowerCase();
    if (error.code === "23P01" || blob.includes("seasons_no_overlap") || blob.includes("exclusion")) {
      return res
        .status(409)
        .json({ error: "Ese rango de fechas se solapa con otra temporada." });
    }
    console.error("[admin/seasons] upsert:", error);
    return res.status(500).json({ error: "Failed to save season", detail: error.message });
  }
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ season: data });
}

async function handleDelete(req, res) {
  const body = parseBody(req) || {};
  const id = cleanStr(body.id) || cleanStr(req.query?.id);
  if (!id) return res.status(400).json({ error: "Falta el id de la temporada." });
  const { error } = await getSupabaseAdmin().from("seasons").delete().eq("id", id);
  if (error) {
    console.error("[admin/seasons] delete:", error);
    return res.status(500).json({ error: "Failed to delete season" });
  }
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true });
}
