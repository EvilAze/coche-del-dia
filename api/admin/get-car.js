// api/admin/get-car.js
// Devuelve datos completos de un coche (incluyendo image_url) a un admin
// autenticado. Necesario para Preview.jsx tras revocar SELECT(image_url) a
// anon/authenticated.

import { supabaseAdmin } from "../_lib/supabase.js";
import { requireAdmin } from "../_lib/auth.js";
import { methodGuard } from "../_lib/http.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (methodGuard(req, res, "GET")) return;

  if (!supabaseAdmin) {
    console.error("[admin/get-car] missing SUPABASE_SERVICE_ROLE_KEY");
    return res.status(500).json({ message: "Server misconfigured" });
  }

  const { error: authError } = await requireAdmin(req);
  if (authError) {
    return res.status(authError.status).json({ message: authError.message });
  }

  const id = req.query.id;
  if (!id || typeof id !== "string" || !UUID_RE.test(id)) {
    return res.status(400).json({ message: "Invalid id" });
  }

  const { data, error } = await supabaseAdmin
    .from("cars")
    .select("id, make, model, year, pais, description, description_en, image_url")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[admin/get-car]", error);
    return res.status(500).json({ message: "Read failed" });
  }
  if (!data) return res.status(404).json({ message: "Not found" });

  res.status(200).json({
    id: data.id,
    marca: data.make,
    modelo: data.model,
    anio: data.year,
    pais: data.pais,
    description: data.description ?? null,
    description_en: data.description_en ?? null,
    img: data.image_url,
  });
}
