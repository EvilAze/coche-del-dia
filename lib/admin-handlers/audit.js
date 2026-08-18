// lib/admin-handlers/audit.js
// ---------------------------------------------------------------------
// Endpoint admin de AUDITORÍA anti-trampas. Tres secciones independientes:
//
//   1. suspects  → ranking de sospecha calculado sobre user_guesses (solo
//      partidas DAILY). Mide la "huella de oráculo": ganar clavando
//      marca+modelo+año a la PRIMERA en frío, win-rate ~100%, sin
//      convergencia. NO depende de la IP → caza también a quien rota de
//      red/VPN. Cubre todo el historial (incluido el anterior al logging).
//
//   2. flags     → correlación por IP en guess_audit: misma IP que sondea
//      el coche de un día bajo una identidad (anónima u otra cuenta) y
//      luego lo gana a la 1ª con una cuenta logueada.
//
//   3. canaries  → eventos "canary": tokens de reveal forjados/caducados
//      presentados a /api/daily-image. Un cliente legítimo nunca los hace.
//
// Query string: ?range=7d|14d|30d|90d|all   (default 14d)
// Auth: requireAdmin — solo emails de la whitelist.
// ---------------------------------------------------------------------

import { getSupabaseAdmin, getMissingAdminEnvs } from "../../api/_lib/supabase.js";
import { requireAdmin } from "../../api/_lib/auth.js";
import { methodGuard } from "../../api/_lib/http.js";
import { todayInMadrid } from "../../api/_lib/date.js";
import { captureServerError } from "../../api/_lib/sentry.js";

const RANGES = { "7d": 7, "14d": 14, "30d": 30, "90d": 90, "all": null };
const MIN_GAMES = 5; // muestra mínima para entrar al ranking de sospecha

function isoDateDaysAgo(n) {
  const ref = todayInMadrid();
  const d = new Date(`${ref}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Pagina una query de PostgREST hasta agotar las filas. CRÍTICO para la
// auditoría: Supabase/PostgREST corta en 1000 filas por defecto, así que una
// query "plana" sobre guess_audit o user_guesses analizaba SOLO las 1000 más
// antiguas y daba falsos negativos (un win reciente fuera del corte no se
// veía). `buildQuery` debe devolver una query NUEVA en cada llamada porque el
// builder de supabase-js es de un solo uso una vez await-eado; le encadenamos
// .range() para ir trayendo bloques consecutivos manteniendo el .order() que
// ya traiga.
async function fetchAllRows(buildQuery, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    if (!data?.length) break;
    out.push(...data);
    if (data.length < pageSize) break; // última página
  }
  return { data: out, error: null };
}

// Carga TODOS los emails (id -> email) en una pasada. Lo usan las 3 secciones.
async function loadEmails(admin) {
  const emailById = new Map();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    for (const u of data?.users || []) emailById.set(u.id, u.email || u.id);
    if (!data?.users?.length || data.users.length < 1000) break;
  }
  return emailById;
}

// ---------- Sección 1: ranking de sospecha (user_guesses daily) --------
async function computeSuspects(admin, fromIso, emailById) {
  // Mapa date -> car_id del daily, para aislar partidas daily (las repescas
  // tienen car_id != daily y contaminarían: el veterano gana en 1 intento
  // sabiendo la respuesta legítimamente).
  const { data: dailies, error: dErr } = await fetchAllRows(() => {
    let dq = admin.from("daily_cars").select("date, car_id");
    if (fromIso) dq = dq.gte("date", fromIso);
    return dq;
  });
  if (dErr) {
    console.error("[admin/audit] daily_cars:", dErr);
    return [];
  }
  const dailyByDate = new Map();
  for (const r of dailies || []) dailyByDate.set(r.date, r.car_id);

  const { data: rows, error: gErr } = await fetchAllRows(() => {
    let gq = admin
      .from("user_guesses")
      .select("user_id, car_id, date, status, guesses")
      .in("status", ["won", "lost"]);
    if (fromIso) gq = gq.gte("date", fromIso);
    return gq;
  });
  if (gErr) {
    console.error("[admin/audit] user_guesses:", gErr);
    return [];
  }

  // Agregado por usuario, solo partidas daily.
  const byUser = new Map();
  for (const r of rows || []) {
    if (dailyByDate.get(r.date) !== r.car_id) continue; // descarta repescas
    if (!byUser.has(r.user_id)) {
      byUser.set(r.user_id, { n: 0, wins: 0, coldExact: 0 });
    }
    const u = byUser.get(r.user_id);
    u.n++;
    if (r.status === "won") u.wins++;
    const g = Array.isArray(r.guesses) ? r.guesses : [];
    const first = g[0];
    if (
      first &&
      first.marca?.status === "correct" &&
      first.modelo?.status === "correct" &&
      first.anio?.status === "correct"
    ) {
      u.coldExact++;
    }
  }

  const suspects = [];
  for (const [userId, u] of byUser) {
    if (u.n < MIN_GAMES) continue;
    const winRate = u.wins / u.n;
    const coldExactRate = u.coldExact / u.n;
    // El acierto frío a la 1ª es la señal fuerte; el win-rate la modula.
    const score = Math.round(100 * (0.65 * coldExactRate + 0.35 * winRate));
    suspects.push({
      email: emailById.get(userId) || userId,
      userId,
      games: u.n,
      wins: u.wins,
      losses: u.n - u.wins,
      winRate,
      coldExact: u.coldExact,
      coldExactRate,
      score,
    });
  }

  // Línea base poblacional: media y desviación típica del ratio de acierto
  // frío a la 1ª sobre TODOS los jugadores con muestra suficiente (no solo el
  // top 30). Permite expresar cada caso como "cuántas σ por encima de la
  // media" — una señal estadística NO dirigida: la misma vara para todos, sin
  // perseguir a un alias concreto. Un z alto significa "este jugador clava el
  // coche en frío muchísimo más que el resto del campo", que es justo lo que
  // un detector honesto debe medir (anomalía relativa, no sospecha a dedo).
  const rates = suspects.map((s) => s.coldExactRate);
  const mean = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  const variance = rates.length
    ? rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length
    : 0;
  const std = Math.sqrt(variance);
  for (const s of suspects) {
    // std=0 (todos idénticos) → z=0 para no dividir por cero.
    s.coldExactZ = std > 0 ? Number(((s.coldExactRate - mean) / std).toFixed(2)) : 0;
  }
  const population = {
    users: rates.length,
    meanColdExactRate: Number(mean.toFixed(4)),
    stdColdExactRate: Number(std.toFixed(4)),
  };

  // Orden: huella de oráculo desc, luego win-rate, luego muestra.
  suspects.sort(
    (a, b) =>
      b.coldExactRate - a.coldExactRate ||
      b.winRate - a.winRate ||
      b.games - a.games
  );
  return { suspects: suspects.slice(0, 30), population };
}

// ---------- Time-to-win por usuario (sale de guess_audit) -----------
// Para cada win logueado, busca el session_start MÁS TEMPRANO del mismo
// (user_id, game_date) y calcula delta = win.ts − session_start.ts en seg.
// Devuelve por userId la mediana de los deltas y cuántas mediciones hay.
// Solo cubre wins POSTERIORES a la activación del logging. Los wins
// históricos no tienen session_start → no entran en la mediana.
async function computeTimeToWin(admin, userIds) {
  if (!userIds.length) return new Map();
  const { data, error } = await fetchAllRows(() =>
    admin
      .from("guess_audit")
      .select("user_id, game_date, ts, mode, win, attempt_number")
      .in("user_id", userIds)
      .in("mode", ["session_start", "daily"])
  );
  if (error) {
    console.error("[admin/audit] time-to-win read:", error);
    return new Map();
  }
  // Agrupar por (user_id|game_date) y quedarnos con (min session_start,
  // primer win). Si el usuario abrió la página, jugó y ganó: tenemos delta.
  const byKey = new Map();
  for (const r of data || []) {
    const k = `${r.user_id}|${r.game_date}`;
    if (!byKey.has(k)) byKey.set(k, { start: null, win: null });
    const slot = byKey.get(k);
    const ts = new Date(r.ts).getTime();
    if (r.mode === "session_start") {
      if (slot.start == null || ts < slot.start) slot.start = ts;
    } else if (r.mode === "daily" && r.win) {
      if (slot.win == null || ts < slot.win) slot.win = ts;
    }
  }
  // Acumular deltas por user_id.
  const deltasByUser = new Map();
  for (const [k, slot] of byKey) {
    if (slot.start == null || slot.win == null) continue;
    const delta = Math.max(0, Math.round((slot.win - slot.start) / 1000));
    const userId = k.split("|")[0];
    if (!deltasByUser.has(userId)) deltasByUser.set(userId, []);
    deltasByUser.get(userId).push(delta);
  }
  // Mediana por usuario.
  const out = new Map();
  for (const [userId, arr] of deltasByUser) {
    arr.sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    const median = arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
    out.set(userId, { medianSec: median, n: arr.length, min: arr[0], max: arr[arr.length - 1] });
  }
  return out;
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

    const emailById = await loadEmails(admin);

    // --- Sección 1: ranking de sospecha (independiente de guess_audit) ---
    const { suspects, population } = await computeSuspects(admin, fromIso, emailById);

    // Quién está YA fuera de las tablas públicas. El panel lo necesita para
    // pintar el estado del botón: sin esto, «Excluir» aparecería igual sobre
    // alguien que ya lo está y no habría forma de readmitirlo desde la
    // interfaz. Tolerante a que la migración no esté aplicada todavía — el
    // panel entero no puede caerse por una tabla que aún no existe (mismo
    // criterio que `migrationPending` de aquí arriba).
    let excluidos = [];
    {
      const { data, error } = await admin
        .from("excluidos_de_clasificacion")
        .select("user_id");
      if (error) {
        console.warn("[admin/audit] excluidos no disponible:", error.message);
      } else {
        excluidos = (data || []).map((r) => r.user_id);
      }
    }

    // Enriquecer con time-to-win por usuario (sale de guess_audit; solo
    // cubre wins POSTERIORES a la activación del logging de session_start).
    const ttwByUser = await computeTimeToWin(admin, suspects.map((s) => s.userId));
    for (const s of suspects) {
      const t = ttwByUser.get(s.userId);
      s.timeToWin = t ? { medianSec: t.medianSec, n: t.n, min: t.min, max: t.max } : null;
    }

    // --- Secciones 2 y 3: dependen de guess_audit ---
    const { data: auditRows, error: rowsErr } = await fetchAllRows(() => {
      let q = admin
        .from("guess_audit")
        .select("ts, mode, game_date, car_id, user_id, is_anon, attempt_number, ip_hash, guess_make, guess_model, guess_year, marca_status, modelo_status, anio_status, win, note")
        .order("ts", { ascending: true });
      if (fromIso) q = q.gte("game_date", fromIso);
      return q;
    });

    let migrationPending = false;
    let flags = [];
    let canaries = [];
    let totalRows = 0;
    let groupsCount = 0;

    if (rowsErr) {
      // Tabla aún no creada. PostgREST la reporta como PGRST205 (no la
      // encuentra en el schema cache), NO con el 42P01 crudo de Postgres
      // —verificado contra Supabase—. Dejamos 42P01 como red de seguridad
      // por si en algún path llega el código nativo.
      if (rowsErr.code === "PGRST205" || rowsErr.code === "42P01") {
        migrationPending = true; // tabla aún no creada
      } else {
        console.error("[admin/audit] read guess_audit:", rowsErr);
        return res.status(500).json({ error: "Failed to read audit log" });
      }
    } else if (auditRows?.length) {
      totalRows = auditRows.length;
      // session_start y canary tienen su propio uso (time-to-win y canarios);
      // fuera de la correlación IP de guesses.
      const guessRows = auditRows.filter(
        (r) => r.mode !== "canary" && r.mode !== "session_start"
      );
      const canaryRows = auditRows.filter((r) => r.mode === "canary");

      // Sección 2: correlación por IP.
      const groups = new Map();
      for (const r of guessRows) {
        if (!r.ip_hash) continue;
        const k = `${r.game_date}|${r.car_id}|${r.ip_hash}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
      }
      groupsCount = groups.size;

      const carIds = new Set();
      const rawFlags = [];
      for (const [k, list] of groups) {
        const [game_date, car_id, ip_hash] = k.split("|");
        const userIds = new Set(list.filter((r) => r.user_id).map((r) => r.user_id));
        const hasAnon = list.some((r) => r.is_anon);
        const winFirst = list.find((r) => r.win && !r.is_anon && r.attempt_number === 1);
        if (winFirst && (hasAnon || userIds.size > 1)) {
          carIds.add(car_id);
          rawFlags.push({ game_date, car_id, ip_hash, list, winnerId: winFirst.user_id });
        }
      }

      const carById = new Map();
      if (carIds.size > 0) {
        const { data: cars } = await admin
          .from("cars")
          .select("id, make, model, year")
          .in("id", [...carIds]);
        for (const c of cars || []) carById.set(c.id, c);
      }

      flags = rawFlags
        .sort((a, b) => (a.game_date < b.game_date ? 1 : -1))
        .map((f) => {
          const car = carById.get(f.car_id) || {};
          return {
            date: f.game_date,
            car: { id: f.car_id, marca: car.make || "—", modelo: car.model || "—", anio: car.year || null },
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

      // Sección 3: canarios (últimos primero).
      canaries = canaryRows
        .sort((a, b) => (a.ts < b.ts ? 1 : -1))
        .slice(0, 100)
        .map((r) => ({
          ts: r.ts,
          reason: r.note || "—",
          who: r.is_anon ? "ANÓNIMO" : (emailById.get(r.user_id) || r.user_id),
          isAnon: r.is_anon,
          ipHash: r.ip_hash ? r.ip_hash.slice(0, 12) : null,
        }));
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      migrationPending,
      range: rangeKey,
      totalRows,
      groups: groupsCount,
      flaggedWinners: new Set(flags.map((f) => f.winnerEmail)).size,
      suspects,
      excluidos,
      population,
      flags,
      canaries,
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
