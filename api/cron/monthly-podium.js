// api/cron/monthly-podium.js
// Cron MENSUAL que cierra el podio del mes anterior y lo materializa en la
// tabla `monthly_podium`. A diferencia de warm-daily (que hace fetches HTTP
// internos), aquí llamamos directamente a la RPC con service_role: la lógica
// vive en Supabase (snapshot_previous_month_podium → compute_monthly_podium),
// este handler solo la dispara y reporta el resultado.
//
// SCHEDULE: día 1 de cada mes (ver vercel.json). El día 1 ya es un mes nuevo
// en Madrid, así que "mes anterior" es el mes recién cerrado. Si el cron
// fallara un día, la operación es idempotente: re-ejecutarla recalcula sin
// duplicar (compute_monthly_podium borra y reinserta el mes).
//
// AUTH: Vercel firma las requests del scheduler con
// `Authorization: Bearer ${CRON_SECRET}`. Verificamos el secreto igual que en
// warm-daily para que nadie externo pueda dispararlo.
//
// REQUISITO: ejecutar antes scripts/supabase-monthly-ranking.sql en Supabase
// (crea la RPC y la tabla).

import { getSupabaseAdmin, getMissingAdminEnvs } from "../_lib/supabase.js";

export default async function handler(req, res) {
  // ---- AUTH --------------------------------------------------------------
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.error("[cron/monthly-podium] CRON_SECRET env var not configured");
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
      `[cron/monthly-podium] missing env vars: ${getMissingAdminEnvs().join(", ")}`
    );
    return res.status(500).json({ error: "Server misconfigured" });
  }

  // ---- Disparar el snapshot del mes anterior -----------------------------
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    const { data, error } = await supabaseAdmin.rpc(
      "snapshot_previous_month_podium"
    );
    if (error) {
      console.error("[cron/monthly-podium] RPC error:", error);
      return res.status(500).json({
        ok: false,
        startedAt,
        totalMs: Date.now() - t0,
        error: error.message || "RPC failed",
      });
    }

    // `data` = nº de filas de podio escritas (0 si el mes no llegó al umbral
    // mínimo de jugadores activos).
    return res.status(200).json({
      ok: true,
      startedAt,
      totalMs: Date.now() - t0,
      podiumRowsWritten: typeof data === "number" ? data : data ?? null,
    });
  } catch (err) {
    console.error("[cron/monthly-podium] UNCAUGHT:", err?.stack || err);
    return res.status(500).json({
      ok: false,
      startedAt,
      totalMs: Date.now() - t0,
      error: err?.message || "Internal error",
    });
  }
}
