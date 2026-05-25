// api/admin/analytics.js
// ---------------------------------------------------------------------
// Endpoint único que agrega TODAS las métricas del panel de analítica
// del admin. Diseño en un solo endpoint en lugar de N pequeños porque:
//   - Atomicidad: el snapshot completo se calcula con la misma ventana
//     temporal, no hay drift entre métricas.
//   - Una sola autenticación + un solo round-trip de red desde el front.
//   - El payload es pequeño (~5-15 KB) — no compensa partirlo.
//
// Query string:
//   ?range=24h | 7d | 14d | 30d | 90d
//   ?userId=<uuid>   (opcional, devuelve historial detallado de ese user)
//
// Auth: requireAdmin — solo emails de la whitelist.
// ---------------------------------------------------------------------

import { getSupabaseAdmin, getMissingAdminEnvs } from "../../api/_lib/supabase.js";
import { requireAdmin } from "../../api/_lib/auth.js";
import { methodGuard } from "../../api/_lib/http.js";
import { todayInMadrid } from "../../api/_lib/date.js";
import { captureServerError } from "../../api/_lib/sentry.js";

const RANGES = {
  "24h": { days: 1, label: "Últimas 24h" },
  "7d":  { days: 7, label: "Últimos 7 días" },
  "14d": { days: 14, label: "Últimas 2 semanas" },
  "30d": { days: 30, label: "Últimos 30 días" },
  "90d": { days: 90, label: "Últimos 90 días" },
};

// Devuelve la fecha (en zona Madrid) de hace N días en formato YYYY-MM-DD.
// Lo usamos como cota inferior en los filtros sobre user_guesses.date.
function isoDateDaysAgo(n) {
  const ref = todayInMadrid(); // "YYYY-MM-DD"
  const d = new Date(`${ref}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Genera el array de fechas (YYYY-MM-DD) entre `from` y `to` inclusive.
// Útil para rellenar huecos en series temporales: si un día no tuvo plays
// queremos un punto con count=0, no un hueco en el eje X.
function dateRangeInclusive(fromIso, toIso) {
  const out = [];
  const start = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toIso}T00:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Bucketing para distribución de rachas. Granular en valores bajos
// (donde se concentra la masa), agrupado en bandas en valores altos.
const STREAK_BUCKETS = [
  { label: "0",      min: 0,   max: 0   },
  { label: "1-2",    min: 1,   max: 2   },
  { label: "3-6",    min: 3,   max: 6   },
  { label: "7-13",   min: 7,   max: 13  },
  { label: "14-29",  min: 14,  max: 29  },
  { label: "30-59",  min: 30,  max: 59  },
  { label: "60-99",  min: 60,  max: 99  },
  { label: "100+",   min: 100, max: Infinity },
];

function bucketStreak(streak) {
  return STREAK_BUCKETS.find((b) => streak >= b.min && streak <= b.max);
}

// ---------- Bloque 1: usuarios ----------------------------------------

async function fetchUsers(supabaseAdmin, fromIso) {
  // listUsers de admin API: máximo 1000 por página. Para nuestra escala
  // (~100s de usuarios) basta una página. Documentamos la paginación por
  // si en el futuro crece.
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) {
    console.error("[admin/analytics] listUsers:", error);
    return { total: 0, newInPeriod: 0, lastLogins: [], all: [] };
  }
  const users = data?.users || [];
  const fromMs = new Date(`${fromIso}T00:00:00Z`).getTime();
  const newInPeriod = users.filter(
    (u) => u.created_at && new Date(u.created_at).getTime() >= fromMs
  ).length;

  // Últimos 20 logins ordenados desc. Filtramos usuarios sin login (puede
  // pasar con cuentas creadas vía admin/SQL sin haber iniciado sesión).
  const lastLogins = [...users]
    .filter((u) => u.last_sign_in_at)
    .sort(
      (a, b) =>
        new Date(b.last_sign_in_at).getTime() -
        new Date(a.last_sign_in_at).getTime()
    )
    .slice(0, 20)
    .map((u) => ({
      id: u.id,
      email: u.email,
      lastSignInAt: u.last_sign_in_at,
      createdAt: u.created_at,
    }));

  return {
    total: users.length,
    newInPeriod,
    lastLogins,
    all: users, // para uso interno (retención, conversión, etc.)
  };
}

// ---------- Bloque 2: DAU ---------------------------------------------

async function fetchDauSeries(supabaseAdmin, fromIso, toIso) {
  // user_guesses tiene una fila por (user_id, car_id, date). Para DAU
  // contamos usuarios distintos por día. RLS bypass con admin client.
  const { data, error } = await supabaseAdmin
    .from("user_guesses")
    .select("user_id, date")
    .gte("date", fromIso)
    .lte("date", toIso);
  if (error) {
    console.error("[admin/analytics] DAU read:", error);
    return [];
  }
  // Aggregate manual en JS — más rápido que múltiples queries y la
  // cardinalidad es baja (cientos de filas/día como máximo).
  const byDate = new Map(); // date -> Set<userId>
  for (const row of data || []) {
    if (!byDate.has(row.date)) byDate.set(row.date, new Set());
    byDate.get(row.date).add(row.user_id);
  }
  // Rellenar huecos con count=0 para que el chart no tenga discontinuidades.
  return dateRangeInclusive(fromIso, toIso).map((date) => ({
    date,
    count: byDate.has(date) ? byDate.get(date).size : 0,
  }));
}

// ---------- Bloque 3: Retención D1 / D7 -------------------------------

async function fetchRetention(supabaseAdmin, fromIso) {
  // Estrategia simple para cohort retention:
  //   1. Para cada user, encontrar su primera fecha de juego (first_date).
  //   2. Filtrar cohort: usuarios cuyo first_date >= fromIso Y que haya
  //      pasado tiempo suficiente para evaluar (D1 → al menos 1 día desde
  //      first_date hasta hoy; D7 → 7 días).
  //   3. De ese cohort, contar cuántos volvieron en D+1 / D+7.
  //
  // Esta query trae todo user_guesses del rango — para escalas grandes
  // habría que migrar a una función SQL en Supabase, pero para nuestra
  // escala (cientos de filas) es eficiente y mantiene la lógica en JS.
  const { data, error } = await supabaseAdmin
    .from("user_guesses")
    .select("user_id, date");
  if (error) {
    console.error("[admin/analytics] retention read:", error);
    return { d1: null, d7: null };
  }

  // Map user_id -> Set<date>
  const playsByUser = new Map();
  for (const row of data || []) {
    if (!playsByUser.has(row.user_id)) playsByUser.set(row.user_id, new Set());
    playsByUser.get(row.user_id).add(row.date);
  }

  const today = todayInMadrid();
  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  const fromMs = new Date(`${fromIso}T00:00:00Z`).getTime();

  function dayOffset(dateIso, offset) {
    const d = new Date(`${dateIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  }

  let d1Cohort = 0;
  let d1Returned = 0;
  let d7Cohort = 0;
  let d7Returned = 0;

  for (const [, dates] of playsByUser) {
    const sorted = [...dates].sort();
    const first = sorted[0];
    const firstMs = new Date(`${first}T00:00:00Z`).getTime();

    // Solo contar cohorts dentro del rango de análisis (usuarios cuya
    // primera partida sea >= fromIso).
    if (firstMs < fromMs) continue;

    // D1: cohort maduro = first + 1 <= hoy.
    if (firstMs + 24 * 3600 * 1000 <= todayMs) {
      d1Cohort++;
      if (dates.has(dayOffset(first, 1))) d1Returned++;
    }
    // D7: cohort maduro = first + 7 <= hoy.
    if (firstMs + 7 * 24 * 3600 * 1000 <= todayMs) {
      d7Cohort++;
      if (dates.has(dayOffset(first, 7))) d7Returned++;
    }
  }

  return {
    d1: {
      cohort: d1Cohort,
      returned: d1Returned,
      rate: d1Cohort > 0 ? d1Returned / d1Cohort : null,
    },
    d7: {
      cohort: d7Cohort,
      returned: d7Returned,
      rate: d7Cohort > 0 ? d7Returned / d7Cohort : null,
    },
  };
}

// ---------- Bloque 4: Win rate distribution ---------------------------

async function fetchWinRateDistribution(supabaseAdmin, fromIso, toIso) {
  // Solo partidas cerradas (won | lost) dentro del rango. Para cada una
  // contamos el número de intentos (length del array guesses).
  const { data, error } = await supabaseAdmin
    .from("user_guesses")
    .select("status, guesses")
    .in("status", ["won", "lost"])
    .gte("date", fromIso)
    .lte("date", toIso);
  if (error) {
    console.error("[admin/analytics] winrate read:", error);
    return [];
  }
  // Buckets: won-1, won-2, ..., won-5, lost.
  const buckets = {
    "won-1": 0, "won-2": 0, "won-3": 0, "won-4": 0, "won-5": 0,
    "lost": 0,
  };
  for (const row of data || []) {
    if (row.status === "lost") {
      buckets["lost"]++;
    } else if (row.status === "won") {
      const attempts = Array.isArray(row.guesses) ? row.guesses.length : 0;
      const key = `won-${Math.max(1, Math.min(5, attempts))}`;
      buckets[key]++;
    }
  }
  // Output ordenado y plano para el front.
  return [
    { key: "won-1", label: "Ganó al 1º", count: buckets["won-1"], kind: "win" },
    { key: "won-2", label: "Ganó al 2º", count: buckets["won-2"], kind: "win" },
    { key: "won-3", label: "Ganó al 3º", count: buckets["won-3"], kind: "win" },
    { key: "won-4", label: "Ganó al 4º", count: buckets["won-4"], kind: "win" },
    { key: "won-5", label: "Ganó al 5º", count: buckets["won-5"], kind: "win" },
    { key: "lost",  label: "Perdió",    count: buckets["lost"],  kind: "loss" },
  ];
}

// ---------- Bloque 5: Coches más fallados -----------------------------

async function fetchHardestCars(supabaseAdmin, fromIso, toIso) {
  // Solo daily mode: filtramos para que las repescas no contaminen el
  // dato (en repesca veterano solo hay 1 intento → ratio de loss falso).
  // Heurística: row.car_id matches daily_cars.car_id para esa fecha.
  // Implementación simple: traer todos los daily_cars del rango, indexar,
  // filtrar user_guesses por (date, car_id) que estén en ese conjunto.
  const [dailyResp, guessesResp] = await Promise.all([
    supabaseAdmin
      .from("daily_cars")
      .select("date, car_id")
      .gte("date", fromIso)
      .lte("date", toIso),
    supabaseAdmin
      .from("user_guesses")
      .select("car_id, status, date")
      .in("status", ["won", "lost"])
      .gte("date", fromIso)
      .lte("date", toIso),
  ]);

  if (dailyResp.error) console.error("[admin/analytics] daily_cars:", dailyResp.error);
  if (guessesResp.error) console.error("[admin/analytics] hardest read:", guessesResp.error);

  const dailyByDate = new Map(); // date -> car_id
  for (const row of dailyResp.data || []) dailyByDate.set(row.date, row.car_id);

  // car_id -> { plays, losses }
  const byCar = new Map();
  for (const row of guessesResp.data || []) {
    // Filtrar a partidas daily (car_id de ese día coincide con el row.car_id)
    if (dailyByDate.get(row.date) !== row.car_id) continue;
    if (!byCar.has(row.car_id)) byCar.set(row.car_id, { plays: 0, losses: 0 });
    const b = byCar.get(row.car_id);
    b.plays++;
    if (row.status === "lost") b.losses++;
  }

  // Filtrar por muestra mínima (n>=5) y ordenar por lose rate desc.
  const ranked = [...byCar.entries()]
    .filter(([, b]) => b.plays >= 5)
    .map(([carId, b]) => ({
      carId,
      plays: b.plays,
      losses: b.losses,
      loseRate: b.losses / b.plays,
    }))
    .sort((a, b) => b.loseRate - a.loseRate)
    .slice(0, 10);

  if (ranked.length === 0) return [];

  // Resolver carId -> marca/modelo/año
  const ids = ranked.map((r) => r.carId);
  const { data: cars, error: carsErr } = await supabaseAdmin
    .from("cars")
    .select("id, make, model, year")
    .in("id", ids);
  if (carsErr) {
    console.error("[admin/analytics] cars resolve:", carsErr);
    return ranked; // sin metadata, mejor que vacío
  }
  const carMeta = new Map((cars || []).map((c) => [c.id, c]));
  return ranked.map((r) => {
    const meta = carMeta.get(r.carId) || {};
    return {
      carId: r.carId,
      marca: meta.make || "—",
      modelo: meta.model || "—",
      anio: meta.year || null,
      plays: r.plays,
      losses: r.losses,
      loseRate: r.loseRate,
    };
  });
}

// ---------- Bloque 6: Distribución de rachas --------------------------

async function fetchStreakDistribution(supabaseAdmin) {
  // Snapshot ACTUAL (no depende del range). Refleja las rachas vivas
  // hoy mismo en la tabla stats. Si el usuario rompió racha ayer, su
  // current_streak es 0 y entra al bucket "0".
  const { data, error } = await supabaseAdmin
    .from("stats")
    .select("current_streak");
  if (error) {
    console.error("[admin/analytics] streak dist:", error);
    return STREAK_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  }
  const counts = new Map(STREAK_BUCKETS.map((b) => [b.label, 0]));
  for (const row of data || []) {
    const s = Math.max(0, row.current_streak || 0);
    const b = bucketStreak(s);
    if (b) counts.set(b.label, counts.get(b.label) + 1);
  }
  return STREAK_BUCKETS.map((b) => ({
    label: b.label,
    count: counts.get(b.label) || 0,
  }));
}

// ---------- Bloque 7: Repesca usage -----------------------------------

async function fetchRepescaUsage(supabaseAdmin, fromIso) {
  // Usuarios con last_repesca_at dentro del rango / total usuarios.
  // total = filas en stats (no auth.users) porque un usuario sin partida
  // jugada no tiene row en stats — no puede usar repesca de todas formas.
  const [usedResp, totalResp] = await Promise.all([
    supabaseAdmin
      .from("stats")
      .select("user_id", { count: "exact", head: true })
      .gte("last_repesca_at", fromIso),
    supabaseAdmin
      .from("stats")
      .select("user_id", { count: "exact", head: true }),
  ]);
  if (usedResp.error) console.error("[admin/analytics] repesca used:", usedResp.error);
  if (totalResp.error) console.error("[admin/analytics] repesca total:", totalResp.error);

  const usersUsed = usedResp.count || 0;
  const totalUsers = totalResp.count || 0;
  return {
    usersUsed,
    totalUsers,
    rate: totalUsers > 0 ? usersUsed / totalUsers : null,
  };
}

// ---------- Bloque 8: Historial de un usuario (drill-down) ------------

async function fetchUserHistory(supabaseAdmin, userId) {
  // Últimas 30 partidas + meta del coche. El JOIN se hace en JS por
  // limitaciones del SDK PostgREST (relación cross-schema awkward).
  const { data: guesses, error: gErr } = await supabaseAdmin
    .from("user_guesses")
    .select("car_id, date, status, guesses")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(30);
  if (gErr) {
    console.error("[admin/analytics] user history:", gErr);
    return [];
  }
  const carIds = [...new Set((guesses || []).map((g) => g.car_id))];
  if (carIds.length === 0) return [];

  const { data: cars, error: cErr } = await supabaseAdmin
    .from("cars")
    .select("id, make, model, year")
    .in("id", carIds);
  if (cErr) console.error("[admin/analytics] user history cars:", cErr);

  const carMeta = new Map((cars || []).map((c) => [c.id, c]));
  return (guesses || []).map((g) => {
    const c = carMeta.get(g.car_id) || {};
    return {
      date: g.date,
      status: g.status,
      attempts: Array.isArray(g.guesses) ? g.guesses.length : 0,
      carId: g.car_id,
      marca: c.make || "—",
      modelo: c.model || "—",
      anio: c.year || null,
    };
  });
}

// ---------- Handler principal -----------------------------------------

export default async function handler(req, res) {
  if (methodGuard(req, res, "GET")) return;

  try {
    if (!getSupabaseAdmin()) {
      console.error(`[admin/analytics] missing env vars: ${getMissingAdminEnvs().join(", ")}`);
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const { error: authError } = await requireAdmin(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Parse range
    const rangeKey = String(req.query.range || "7d");
    const rangeSpec = RANGES[rangeKey] || RANGES["7d"];
    const fromIso = isoDateDaysAgo(rangeSpec.days - 1); // inclusive de hoy
    const toIso = todayInMadrid();

    // Drill-down opcional: si viene userId, solo devolvemos su historial.
    const userId = req.query.userId ? String(req.query.userId).trim() : null;
    if (userId) {
      const history = await fetchUserHistory(supabaseAdmin, userId);
      return res.status(200).json({ history });
    }

    // Paralelizamos todas las queries para minimizar tiempo total.
    const [
      users,
      dauSeries,
      retention,
      winRateDistribution,
      hardestCars,
      streakDistribution,
      repescaUsage,
    ] = await Promise.all([
      fetchUsers(supabaseAdmin, fromIso),
      fetchDauSeries(supabaseAdmin, fromIso, toIso),
      fetchRetention(supabaseAdmin, fromIso),
      fetchWinRateDistribution(supabaseAdmin, fromIso, toIso),
      fetchHardestCars(supabaseAdmin, fromIso, toIso),
      fetchStreakDistribution(supabaseAdmin),
      fetchRepescaUsage(supabaseAdmin, fromIso),
    ]);

    // DAU promedio en el período (excluye el primer día si rango=24h).
    const dauAvg =
      dauSeries.length > 0
        ? dauSeries.reduce((sum, d) => sum + d.count, 0) / dauSeries.length
        : 0;

    // Limpiar el `all` interno antes de devolver
    const { all: _all, ...usersPublic } = users;

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      range: {
        key: rangeKey,
        label: rangeSpec.label,
        from: fromIso,
        to: toIso,
        days: rangeSpec.days,
      },
      users: usersPublic,
      engagement: {
        dauSeries,
        dauAvg,
        retention,
        repescaUsage,
      },
      gameplay: {
        winRateDistribution,
        hardestCars,
        streakDistribution,
      },
    });
  } catch (err) {
    console.error("[admin/analytics] UNCAUGHT:", err && err.stack ? err.stack : err);
    await captureServerError(err, { endpoint: "admin/analytics" });
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
