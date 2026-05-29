// lib/admin-handlers/audit.js
// ---------------------------------------------------------------------
// Endpoint admin de AUDITORÍA anti-trampas. Lee la tabla oculta
// public.guess_audit (ver scripts/supabase-guess-audit.sql) y delata el
// patrón de "oráculo": una misma IP (ip_hash) que sondea el coche de un
// día bajo una identidad (anónima u otra cuenta) y luego lo gana al PRIMER
// intento con una cuenta logueada.
//
// Query string:
//   ?range=7d | 14d | 30d | 90d | all   (default 14d)
//
// Auth: requireAdmin — solo emails de la whitelist.
// ---------------------------------------------------------------------

import { getSupabaseAdmin, getMissingAdminEnvs } from "../../api/_lib/supabase.js";
import { requireAdmin } from "../../api/_lib/auth.js";
import { methodGuard } from "../../api/_lib/http.js";
import { todayInMadrid } from "../../api/_lib/date.js";
import { captureServerError } from "../../api/_lib/sentry.js";

const RANGES = {
  "7d":  7,
  "14d": 14,
  "30d": 30,
  "90d": 90,
  "all": null,
};

function isoDateDaysAgo(n) {
  const ref = todayInMadrid();
  const d = new Date(`${ref}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (methodGuard(req, res, "GET")) return;

  try {
    if (!getSupabaseAdmin()) {
      console.error(`[admin/audit] missing env vars: ${getMissingAdminEnvs().join(", ")}`);
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const { error: authError } = await requireAdmin(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    const admin = getSupabaseAdmin();

    const rangeKey = RANGES[String(req.query.range)] !== undefined ? String(req.query.range) : "14d";
    const days = RANGES[rangeKey];
    const fromIso = days == null ? null : isoDateDaysAgo(days - 1);

    // 1) Leer filas de auditoría del rango.
    let q = admin
      .from("guess_audit")
      .select("ts, mode, game_date, car_id, user_id, is_anon, anon_n, attempt_number, ip_hash, guess_make, guess_model, guess_year, marca_status, modelo_status, anio_status, win")
      .order("ts", { ascending: true });
    if (fromIso) q = q.gte("game_date", fromIso);

    const { data: rows, error: rowsErr } = await q;
    if (rowsErr) {
      // 42P01 = tabla inexistente → la migración aún no se aplicó.
      if (rowsErr.code === "42P01") {
        return res.status(200).json({
          migrationPending: true,
          range: rangeKey,
          totalRows: 0,
          flags: [],
        });
      }
      console.error("[admin/audit] read guess_audit:", rowsErr);
      return res.status(500).json({ error: "Failed to read audit log" });
    }

    if (!rows?.length) {
      return res.status(200).json({
        migrationPending: false,
        range: rangeKey,
        totalRows: 0,
        flags: [],
      });
    }

    // 2) Agrupar por (game_date, car_id, ip_hash) y detectar el cruce.
    const groups = new Map();
    for (const r of rows) {
      if (!r.ip_hash) continue;
      const k = `${r.game_date}|${r.car_id}|${r.ip_hash}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }

    const rawFlags = [];
    for (const [k, list] of groups) {
      const [game_date, car_id, ip_hash] = k.split("|");
      const userIds = new Set(list.filter((r) => r.user_id).map((r) => r.user_id));
      const hasAnon = list.some((r) => r.is_anon);
      const winFirst = list.find((r) => r.win && !r.is_anon && r.attempt_number === 1);
      // Sospechoso: ganó a la 1ª con cuenta, pero la misma IP además sondeó
      // bajo OTRA identidad (anónima o una 2ª cuenta) el mismo coche/día.
      if (winFirst && (hasAnon || userIds.size > 1)) {
        rawFlags.push({ game_date, car_id, ip_hash, list, winnerId: winFirst.user_id });
      }
    }

    // 3) Resolver emails y metadatos de coche para todos los flags.
    const allUserIds = new Set();
    const allCarIds = new Set();
    for (const f of rawFlags) {
      allCarIds.add(f.car_id);
      for (const r of f.list) if (r.user_id) allUserIds.add(r.user_id);
    }

    const emailById = new Map();
    if (allUserIds.size > 0) {
      // listUsers no filtra por id; paginamos y filtramos en memoria.
      for (let page = 1; page <= 10; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) break;
        for (const u of data?.users || []) {
          if (allUserIds.has(u.id)) emailById.set(u.id, u.email || u.id);
        }
        if (!data?.users?.length || data.users.length < 1000) break;
      }
    }

    const carById = new Map();
    if (allCarIds.size > 0) {
      const { data: cars } = await admin
        .from("cars")
        .select("id, make, model, year")
        .in("id", [...allCarIds]);
      for (const c of cars || []) carById.set(c.id, c);
    }

    // 4) Dar forma al output: orden cronológico desc por día.
    const flags = rawFlags
      .sort((a, b) => (a.game_date < b.game_date ? 1 : -1))
      .map((f) => {
        const car = carById.get(f.car_id) || {};
        return {
          date: f.game_date,
          car: {
            id: f.car_id,
            marca: car.make || "—",
            modelo: car.model || "—",
            anio: car.year || null,
          },
          ipHash: f.ip_hash.slice(0, 12),
          winnerEmail: emailById.get(f.winnerId) || f.winnerId,
          timeline: f.list.map((r) => ({
            ts: r.ts,
            mode: r.mode,
            who: r.is_anon ? "ANÓNIMO" : (emailById.get(r.user_id) || r.user_id),
            isAnon: r.is_anon,
            attempt: r.attempt_number,
            guess: `${r.guess_make || ""} ${r.guess_model || ""} ${r.guess_year || ""}`.trim(),
            marca: r.marca_status,
            modelo: r.modelo_status,
            anio: r.anio_status,
            win: r.win,
          })),
        };
      });

    // 5) Resumen: cuántos emails distintos aparecen como ganadores señalados.
    const flaggedWinners = new Set(flags.map((f) => f.winnerEmail));

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      migrationPending: false,
      range: rangeKey,
      totalRows: rows.length,
      groups: groups.size,
      flaggedWinners: flaggedWinners.size,
      flags,
    });
  } catch (err) {
    console.error("[admin/audit] UNCAUGHT:", err && err.stack ? err.stack : err);
    await captureServerError(err, { endpoint: "admin/audit" });
    return res.status(500).json({
      error: "Internal error",
      detail: process.env.NODE_ENV === "production" ? undefined : String(err?.message || err),
    });
  }
}
