// lib/admin-handlers/pendientes-imagen.js
// Los coches del catálogo que aún NO tienen foto (cars.image_ready = false):
//
//   GET /api/admin/pendientes-imagen  →  { ids: [uuid, …] }
//
// POR QUÉ VIVE AQUÍ Y NO EN /api/list-cars. Antes viajaba en el catálogo
// público como `image_ready`, con el argumento de que «solo dice que el coche
// existe pero aún no es elegible». Eso ES información del sorteo:
// pick_daily_car solo elige entre image_ready = true, así que publicarlo le
// decía a cualquiera qué coches NO pueden salir hoy y recortaba los candidatos
// un tercio (298 de 465 en oct-2026) — exactamente la prueba de la regla 20.
// El único que lo necesita es el filtro «solo pendientes» del panel, así que se
// sirve detrás de requireAdmin y la columna pierde su GRANT a anon/authenticated
// (scripts/2026-10-catalogo-privado.sql).

import { getSupabaseAdmin, getMissingAdminEnvs } from "../../api/_lib/supabase.js";
import { requireAdmin } from "../../api/_lib/auth.js";
import { methodGuard } from "../../api/_lib/http.js";

export default async function handler(req, res) {
  if (methodGuard(req, res, "GET")) return;

  try {
    if (!getSupabaseAdmin()) {
      console.error(
        `[admin/pendientes-imagen] missing env vars: ${getMissingAdminEnvs().join(", ")}`
      );
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const { error: authError } = await requireAdmin(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    const { data, error } = await getSupabaseAdmin()
      .from("cars")
      .select("id")
      .eq("image_ready", false);
    if (error) {
      console.error("[admin/pendientes-imagen]", error.message);
      return res.status(500).json({ error: "DB error" });
    }

    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json({ ids: (data || []).map((r) => r.id) });
  } catch (err) {
    console.error("[admin/pendientes-imagen] UNCAUGHT:", err?.message || err);
    return res.status(500).json({ error: "Internal error" });
  }
}
