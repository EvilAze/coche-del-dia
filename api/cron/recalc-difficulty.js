// api/cron/recalc-difficulty.js
// Cron DIARIO del bucle de dificultad por telemetría (Arquitectura A del DDA).
// Igual que monthly-podium: la lógica vive en Supabase
// (recompute_car_difficulty), este handler solo dispara la RPC con service_role
// y reporta cuántos coches recalculó.
//
// QUÉ HACE: relee daily_stats (toda la audiencia) atribuido a cada coche vía
// daily_cars, recalcula la dificultad observada y deja en cars.suggested_zoom_base
// el zoom_base propuesto. NO aplica nada: el admin revisa y aplica a mano
// (human-in-loop). Ver scripts/2026-06-difficulty-observatory.sql.
//
// SCHEDULE: cada noche (ver vercel.json). Se ejecuta tras el cierre de día de
// Madrid para que el coche de "ayer" tenga su jornada completa contabilizada.
// Recalcula TODOS los coches cada vez (son cientos de filas: barato), así que
// la hora exacta solo afecta a la frescura, no a la correctitud. Idempotente.
//
// AUTH: Vercel firma las requests del scheduler con
// `Authorization: Bearer ${CRON_SECRET}`. Verificamos el secreto igual que en
// warm-daily / monthly-podium para que nadie externo pueda dispararlo.
//
// REQUISITO: ejecutar antes scripts/2026-06-difficulty-observatory.sql en
// Supabase (crea las columnas y la RPC).

import { getSupabaseAdmin, getMissingAdminEnvs } from "../_lib/supabase.js";

export default async function handler(req, res) {
  // ---- AUTH --------------------------------------------------------------
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.error("[cron/recalc-difficulty] CRON_SECRET env var not configured");
    return res.status(500).json({ error: "Cron secret not configured" });
  }
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${expectedSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ---- Cliente admin (service_role) --------------------------------------
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    console.error(
      `[cron/recalc-difficulty] missing env vars: ${getMissingAdminEnvs().join(", ")}`
    );
    return res.status(500).json({ error: "Server misconfigured" });
  }

  // ---- Disparar el recálculo ---------------------------------------------
  // Sin argumentos: usa los defaults del controlador (target 3.5, etc.). Si en
  // el futuro quieres afinar la curva, pásalos aquí o desde el admin.
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    const { data, error } = await supabaseAdmin.rpc("recompute_car_difficulty");
    if (error) {
      console.error("[cron/recalc-difficulty] RPC error:", error);
      return res.status(500).json({
        ok: false,
        startedAt,
        totalMs: Date.now() - t0,
        error: error.message || "RPC failed",
      });
    }

    // `data` = nº de coches recalculados (los que ya tuvieron su día).
    return res.status(200).json({
      ok: true,
      startedAt,
      totalMs: Date.now() - t0,
      carsRecomputed: typeof data === "number" ? data : data ?? null,
    });
  } catch (err) {
    console.error("[cron/recalc-difficulty] UNCAUGHT:", err?.stack || err);
    return res.status(500).json({
      ok: false,
      startedAt,
      totalMs: Date.now() - t0,
      error: err?.message || "Internal error",
    });
  }
}
