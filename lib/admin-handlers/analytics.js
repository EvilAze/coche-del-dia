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
import { DEFAULT_ZOOM_BASE } from "../../api/_lib/zoom.js";

// Objetivo de coste del controlador de dificultad (DDA Arq. A). Réplica del
// default de las RPCs en scripts/2026-06-difficulty-*.sql — mantener en sync.
const DIFFICULTY_TARGET_COST = 3.5;

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

// PostgREST corta la respuesta en `max-rows` filas (1000 por defecto en
// Supabase) y NO avisa de que ha truncado: la query devuelve menos filas y
// nadie se entera. Con el rango de 90 días y ~20 jugadores/día eso se pasa de
// largo, así que el KPI saldría corto sin que fallara nada — exactamente el
// tipo de mentira silenciosa que estamos quitando del panel. Paginamos.
//
// `makeQuery` es una FÁBRICA, no una query: PostgREST/Supabase construye la
// petición al await-earla, así que hay que crear una nueva por página.
async function fetchAllRows(makeQuery, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    out.push(...(data || []));
    // Página incompleta = última página. Evita una petición extra de más.
    if (!data || data.length < pageSize) break;
  }
  return { data: out, error: null };
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

// Exportada para poder probar la paginación: es un fallo que sólo se
// manifiesta pasadas las mil filas, o sea nunca en el entorno de desarrollo y
// de golpe en producción.
export async function fetchUsers(supabaseAdmin, fromIso) {
  // listUsers de la admin API pagina de 1000 en 1000, y AQUÍ SE PAGINA DE
  // VERDAD. Antes se pedía sólo `page: 1` con un comentario que decía que para
  // nuestra escala bastaba y que ya se paginaría si crecía — pero la cuenta no
  // la marcan los usuarios registrados, sino que `auth.users` guarda las DOS
  // poblaciones: cada navegador que juega una partida deja una sesión anónima,
  // y esas no se borran solas (por eso existe el cron
  // `limpiar_sesiones_anonimas`, con 30 días de gracia). Pasado el millar
  // combinado, el corte no daba error: devolvía menos filas en silencio y
  // dejaba clavados a la vez «Usuarios registrados» y «Sesiones anónimas» —
  // justo el KPI que vigila esa acumulación. Mismo bucle que loadEmails() en
  // audit.js.
  const todos = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) {
      console.error("[admin/analytics] listUsers:", error);
      // Sólo se rinde si falla la PRIMERA página. Si revienta la tercera nos
      // quedamos con lo leído: un directorio incompleto informa más que un
      // panel a cero.
      if (page === 1) {
        return { total: 0, newInPeriod: 0, directory: [], anonTotal: 0, anonNewInPeriod: 0 };
      }
      break;
    }
    const lote = data?.users || [];
    todos.push(...lote);
    if (lote.length < 1000) break; // última página
  }
  const fromMs = new Date(`${fromIso}T00:00:00Z`).getTime();

  // auth.users mezcla DOS poblaciones desde jul-2026: cuentas reales y sesiones
  // anónimas (`signInAnonymously` al enviar el primer intento, ver
  // src/lib/auth.js). Sin este corte, cada visitante que juega una partida
  // aparecía como "usuario registrado" y engordaba el KPI de crecimiento: el
  // día que se desplegó la sesión anónima el panel se llenó de filas sin correo
  // ni nombre, con `created_at` == `last_sign_in_at` (sesión creada y nunca
  // refrescada). Mismo criterio que `esCuentaReal()` en el cliente — réplica a
  // propósito: el server no importa de src/.
  const users = todos.filter((u) => u.is_anonymous !== true);
  const anonimos = todos.filter((u) => u.is_anonymous === true);

  const nuevosDesde = (lista) =>
    lista.filter((u) => u.created_at && new Date(u.created_at).getTime() >= fromMs)
      .length;
  const newInPeriod = nuevosDesde(users);

  // Nombre de usuario (display_name) desde public.profiles. profiles.id es la
  // FK a auth.users.id. service_role salta RLS. Si la tabla fallara, seguimos
  // sin nombres (el front cae a email) — nunca rompemos el panel por esto.
  const nameById = new Map();
  const { data: profs, error: pErr } = await supabaseAdmin
    .from("profiles")
    .select("id, display_name");
  if (pErr) console.error("[admin/analytics] profiles:", pErr);
  else for (const p of profs || []) nameById.set(p.id, p.display_name);

  // Directorio COMPLETO de usuarios registrados (antes solo los 20 últimos
  // logins, lo que ocultaba a quien llevaba días sin re-loguear). Orden:
  // último login desc; los que nunca iniciaron sesión caen al final. Solo
  // cuentas reales: una sesión anónima no tiene ni correo ni nombre que listar,
  // solo ensuciaba la tabla con filas «—».
  const directory = [...users]
    .map((u) => ({
      id: u.id,
      email: u.email,
      username: nameById.get(u.id) || null,
      lastSignInAt: u.last_sign_in_at || null,
      createdAt: u.created_at,
    }))
    .sort((a, b) => {
      const ta = a.lastSignInAt ? new Date(a.lastSignInAt).getTime() : 0;
      const tb = b.lastSignInAt ? new Date(b.lastSignInAt).getTime() : 0;
      return tb - ta;
    });

  return {
    total: users.length,
    newInPeriod,
    directory,
    // Las anónimas no se esconden, se cuentan aparte: son el embudo. Cada una
    // es un jugador que llegó hasta el primer intento sin registrarse, así que
    // total vs anónimas es la conversión real. OJO: es UNA FILA POR NAVEGADOR,
    // no por persona (incógnito, borrar datos del sitio o un segundo
    // dispositivo crean otra), y no se borran solas hasta que se programe
    // `limpiar_sesiones_anonimas` — ver
    // scripts/2026-07-limpieza-sesiones-anonimas.sql.
    anonTotal: anonimos.length,
    anonNewInPeriod: nuevosDesde(anonimos),
    // IDs de las sesiones anónimas. Los necesitan las series que salen de
    // user_guesses: desde jul-2026 esa tabla mezcla las dos poblaciones (el
    // anónimo recibe JWT en su primer intento y se persiste por el camino
    // normal, ver src/hooks/useGame.js), así que sin este set no hay forma de
    // separar "registrados" de "anónimos" aguas abajo.
    anonIds: new Set(anonimos.map((u) => u.id)),
  };
}

// ---------- Bloque 2: DAU ---------------------------------------------

// Devuelve el Map date -> Set<userId> EN CRUDO, sin decidir quién cuenta.
// Antes esta función ya devolvía la serie contada, y ahí estaba el problema: no
// puede contar sin saber qué IDs son anónimos, y ese dato lo trae fetchUsers,
// que corre en paralelo. Devolviendo el mapa crudo, la clasificación se hace
// después (serieDesdeMapa) sin perder el paralelismo de las queries.
async function fetchActiveUsersByDate(supabaseAdmin, fromIso, toIso) {
  // user_guesses tiene una fila por (user_id, car_id, date). Para DAU
  // contamos usuarios distintos por día. RLS bypass con admin client.
  const { data, error } = await fetchAllRows(() =>
    supabaseAdmin
      .from("user_guesses")
      .select("user_id, date")
      .gte("date", fromIso)
      .lte("date", toIso)
  );
  if (error) {
    console.error("[admin/analytics] DAU read:", error);
    return new Map();
  }
  // Aggregate manual en JS — más rápido que múltiples queries y la
  // cardinalidad es baja (cientos de filas/día como máximo).
  const byDate = new Map(); // date -> Set<userId>
  for (const row of data || []) {
    if (!byDate.has(row.date)) byDate.set(row.date, new Set());
    byDate.get(row.date).add(row.user_id);
  }
  return byDate;
}

// Convierte un Map date -> Set<userId> en la serie diaria que consume el panel,
// contando solo los usuarios que pasan el filtro. dateRangeInclusive rellena los
// días sin actividad con 0 para que el eje X no tenga discontinuidades.
export function serieDesdeMapa(byDate, fromIso, toIso, incluye) {
  return dateRangeInclusive(fromIso, toIso).map((date) => {
    const ids = byDate.get(date);
    if (!ids) return { date, count: 0 };
    let count = 0;
    for (const id of ids) if (incluye(id)) count += 1;
    return { date, count };
  });
}

// ---------- Bloque 2.bis: Jugadores totales por día (incl. anónimos) ---

async function fetchTotalPlayersSeries(supabaseAdmin, fromIso, toIso) {
  // A diferencia del DAU (user_guesses = SOLO logueados), daily_stats.total_games
  // agrega TODAS las partidas del daily completadas ese día, logueadas y
  // anónimas: increment_daily_stats se llama para ambos en validate-guess
  // (if isGameOver), nunca desde repesca. Como cada persona completa como mucho
  // un daily al día, total_games ≈ jugadores distintos del día (registrados +
  // anónimos). Es la ÚNICA señal histórica que incluye anónimos, así que la
  // métrica es RETROACTIVA por construcción: no requiere tracking nuevo, se
  // apoya en el histórico ya acumulado en daily_stats.
  //
  // Matiz honesto: cuenta partidas COMPLETADAS (no "hizo un intento"), a
  // diferencia del DAU. En la práctica casi todos terminan, así que la línea
  // total queda por encima de la de registrados y el hueco ≈ anónimos.
  const { data, error } = await supabaseAdmin
    .from("daily_stats")
    .select("date, total_games")
    .gte("date", fromIso)
    .lte("date", toIso);
  if (error) {
    console.error("[admin/analytics] total players read:", error);
    return [];
  }
  const byDate = new Map();
  for (const row of data || []) byDate.set(row.date, Number(row.total_games) || 0);
  // Rellenar huecos con 0 para alinear 1:1 con las otras series (mismo rango,
  // mismo orden).
  return dateRangeInclusive(fromIso, toIso).map((date) => ({
    date,
    count: byDate.get(date) || 0,
  }));
}

// Quienes COMPLETARON el daily (status won/lost), distintos por día, en crudo.
// Se calcula sobre la MISMA base que totalSeries (partidas completadas), para
// que la resta total − registrados = anónimos sea exacta y nunca negativa.
// OJO: esto NO es el DAU. El DAU cuenta "hizo ≥1 intento" (actividad); esto
// cuenta "terminó la partida" (finalización), que es lo comparable con
// daily_stats.total_games. Por eso la gráfica de composición usa esta serie y
// no la del DAU.
//
// ⚠️ Esa resta es justo lo que se había roto: al colarse las sesiones anónimas
// en user_guesses, esta serie las contaba como registradas y el «% anónimos»
// tendía a CERO — no porque se fueran, sino porque se habían vuelto invisibles.
// Por eso ahora también devuelve el mapa crudo y filtra fuera.
async function fetchFinishedUsersByDate(supabaseAdmin, fromIso, toIso) {
  const { data, error } = await fetchAllRows(() =>
    supabaseAdmin
      .from("user_guesses")
      .select("user_id, date")
      .in("status", ["won", "lost"])
      .gte("date", fromIso)
      .lte("date", toIso)
  );
  if (error) {
    console.error("[admin/analytics] registered finished read:", error);
    return new Map();
  }
  const byDate = new Map(); // date -> Set<userId>
  for (const row of data || []) {
    if (!byDate.has(row.date)) byDate.set(row.date, new Set());
    byDate.get(row.date).add(row.user_id);
  }
  return byDate;
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

// ⚠️ Este bloque comparaba peras con manzanas y llevaba mintiendo desde que
// existe. El numerador iba acotado al rango (stats.last_repesca_at >= fromIso)
// pero el denominador era el histórico ENTERO (COUNT(*) de stats, sesiones
// anónimas incluidas, sin filtro de fecha). Era el único de los once bloques
// que no acotaba por fecha. Resultado real medido el 31-jul-2026: marcaba
// «6,1% · 5/82» cuando los jugadores activos de esos 7 días eran ~17 — y el
// número EMPEORABA SOLO con el tiempo, porque el denominador solo crece.
//
// Segundo problema: `stats.last_repesca_at` es UNA columna que se sobrescribe
// en cada repesca. Solo sabe decir «la usó al menos una vez», nunca cuántas
// veces, así que no había forma de saber si 5 personas jugaron 5 repescas o 35.
//
// La verdad está en las partidas: una fila de user_guesses cuyo (date, car_id)
// NO es el coche del día de esa fecha es una repesca. Es EXACTAMENTE el mismo
// criterio con el que get_monthly_leaderboard las paga a mitad de puntos
// (scripts/supabase-monthly-ranking.sql); si divergieran, el panel y el ranking
// estarían contando cosas distintas.
//
// DENOMINADOR: jugadores DISTINTOS con partida en el rango. Es la población que
// realmente podía repescar — la repesca exige JWT (`requireUser`), y desde la
// sesión anónima de jul-2026 los anónimos también lo tienen y escriben en
// user_guesses, así que entran a propósito.
async function fetchRepescaUsage(supabaseAdmin, fromIso, toIso) {
  const [guessesResp, dailyResp] = await Promise.all([
    fetchAllRows(() =>
      supabaseAdmin
        .from("user_guesses")
        .select("user_id, date, car_id")
        .gte("date", fromIso)
        .lte("date", toIso)
    ),
    fetchAllRows(() =>
      supabaseAdmin
        .from("daily_cars")
        .select("date, car_id")
        .gte("date", fromIso)
        .lte("date", toIso)
    ),
  ]);
  if (guessesResp.error || dailyResp.error) {
    console.error(
      "[admin/analytics] repesca usage:",
      guessesResp.error || dailyResp.error
    );
    // Degradación honesta: null en vez de un 0% que parecería un dato real.
    return { usersUsed: 0, totalUsers: 0, plays: 0, rate: null };
  }

  // date -> car_id del coche del día, para clasificar cada partida.
  const dailyByDate = new Map();
  for (const d of dailyResp.data || []) dailyByDate.set(d.date, d.car_id);

  return clasificarRepescas(guessesResp.data || [], dailyByDate);
}

// Separada y PURA a propósito: es el corazón del KPI y tiene que aplicar el
// MISMO criterio que get_monthly_leaderboard (scripts/supabase-monthly-ranking.sql),
// que paga las repescas a mitad de puntos. Si divergieran, el panel y el ranking
// estarían contando cosas distintas y nadie se enteraría — por eso tiene test
// propio en analytics.test.js.
export function clasificarRepescas(guesses, dailyByDate) {
  const activePlayers = new Set();  // denominador: quién jugó algo
  const repescaPlayers = new Set(); // numerador en personas
  let plays = 0;                    // numerador en partidas
  for (const g of guesses) {
    activePlayers.add(g.user_id);
    const dailyCarId = dailyByDate.get(g.date);
    // Sin coche del día para esa fecha (hueco en daily_cars) no clasificamos:
    // dar la partida por repesca inflaría el KPI por un agujero de datos, y
    // este panel ya ha mentido bastante.
    if (!dailyCarId || dailyCarId === g.car_id) continue;
    plays += 1;
    repescaPlayers.add(g.user_id);
  }

  const usersUsed = repescaPlayers.size;
  const totalUsers = activePlayers.size;
  return {
    usersUsed,
    totalUsers,
    plays,
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

// ---------- Bloque 9: Dificultad global (DDA Arq. A) ------------------

async function fetchGlobalDifficulty(supabaseAdmin) {
  // Señal AGREGADA de toda la vida del juego (daily_stats = toda la audiencia).
  // A ~10 jugadores/día es la métrica de dificultad MÁS fiable que existe: no
  // afina coches sueltos, pero sí dice si EN CONJUNTO el juego va fácil/difícil
  // y propone un nudge para el default global de zoom. No depende del `range`.
  const { data, error } = await supabaseAdmin.rpc("get_global_difficulty");
  if (error) {
    console.error("[admin/analytics] global difficulty:", error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    totalGames: Number(row.total_games) || 0,
    carsMeasured: Number(row.cars_measured) || 0,
    cost: row.cost ?? null,
    meanWinningAttempt: row.mean_winning_attempt ?? null,
    pBy3: row.p_by_3 ?? null,
    failRate: row.fail_rate ?? null,
    suggestedDefaultBase: row.suggested_default_base ?? null,
    // Contexto para que el front interprete sin hardcodear constantes.
    targetCost: DIFFICULTY_TARGET_COST,
    currentDefaultBase: DEFAULT_ZOOM_BASE,
  };
}

// ---------- Bloque 10: Uso del ranking (contador propio) --------------

// Cuántas veces se abrió el ranking (evento `ranking_open`, registrado por la
// RPC increment_feature_event desde App.jsx → tabla feature_events) y su
// proporción sobre la actividad del periodo, para responder "¿se usa de verdad
// esta palanca?".
//
// La API de Umami es de pago, así que el panel no puede leer de ahí: usamos un
// contador propio en Supabase. Best-effort: si la tabla aún no existe (código
// 42P01) devolvemos {migrationPending:true} y el panel pide aplicar el SQL.
async function fetchRankingUsage(supabaseAdmin, fromIso, toIso) {
  // Pulsaciones del ranking, partidas por (auth) en el rango.
  const evResp = await supabaseAdmin
    .from("feature_events")
    .select("auth, count")
    .eq("event", "ranking_open")
    .gte("date", fromIso)
    .lte("date", toIso);
  if (evResp.error) {
    // Tabla aún no creada. PostgREST la reporta como PGRST205 (no la encuentra
    // en el schema cache); dejamos 42P01 como red por si llega el código crudo
    // de Postgres. Verificado contra Supabase: el código real es PGRST205.
    if (evResp.error.code === "PGRST205" || evResp.error.code === "42P01") {
      return { migrationPending: true };
    }
    console.error("[admin/analytics] feature_events:", evResp.error);
    return null;
  }
  let pulsaciones = 0, byUser = 0, byAnon = 0;
  for (const r of evResp.data || []) {
    const c = Number(r.count) || 0;
    pulsaciones += c;
    if (r.auth === "user") byUser += c;
    else byAnon += c;
  }

  // Denominador de "uso": partidas totales del periodo (logueadas + anónimas)
  // de daily_stats. Cubre a TODA la audiencia (a diferencia de user_guesses,
  // que es solo logueados), así el % es comparable con las pulsaciones, que
  // también incluyen anónimos.
  let activity = 0;
  const stResp = await supabaseAdmin
    .from("daily_stats")
    .select("total_games")
    .gte("date", fromIso)
    .lte("date", toIso);
  if (stResp.error) console.error("[admin/analytics] daily_stats (ranking):", stResp.error);
  else for (const r of stResp.data || []) activity += Number(r.total_games) || 0;

  return {
    migrationPending: false,
    pulsaciones,
    byUser,
    byAnon,
    activity,
    // Proxy de "% de uso": aperturas / partidas del periodo. Son pulsaciones
    // TOTALES (no usuarios únicos): puede pasar del 100% si la gente abre el
    // ranking varias veces. El panel lo etiqueta como tal.
    perPlay: activity > 0 ? pulsaciones / activity : null,
  };
}

// ---------- Bloque 11: Accesos por plataforma (app vs web) ------------

// De dónde entra la gente: app de Play o navegador.
//
// POR QUÉ ES UN BLOQUE APARTE Y NO UNA COLUMNA MÁS DE LOS DEMÁS. Ningún otro
// número de este panel sabe distinguir app de web, y no es un descuido que se
// pueda arreglar aquí: la plataforma se calcula en el cliente
// (src/lib/plataforma.js) y hasta 2026-08 solo viajaba a Umami y a Sentry.
// user_guesses, daily_stats y compañía la mezclan sin remedio, y el histórico
// anterior a esta fecha seguirá mezclado para siempre — no hay backfill posible.
// Lo que hay aquí empieza a contar el día que se despliega, y solo esto.
//
// Unidad: DISPOSITIVOS-DÍA, no personas. El cliente marca una vez por
// dispositivo y día (tope en localStorage, ver src/lib/sesionDiaria.js), así que
// dos navegadores del mismo humano son dos. Lo que se mira aquí es la
// PROPORCIÓN, que es robusta a eso.
//
// 'legacy' = plataforma desconocida: filas de antes de la migración y llamadas
// de APKs sin actualizar (la RPC tiene el argumento por defecto justo para que
// esas pulsaciones no se pierdan ni se cuelen como web). Se devuelve aparte para
// no inflar ninguno de los dos lados; el panel lo enseña como nota al pie.
// Exportada para los tests: el reparto en cubetas y el relleno de días vacíos
// son justo lo que se rompe en silencio (una cubeta mal escrita no da error, da
// un cero convincente).
export async function fetchPlataformas(supabaseAdmin, fromIso, toIso) {
  const { data, error } = await supabaseAdmin
    .from("feature_events")
    .select("date, plataforma, count")
    .eq("event", "sesion")
    .gte("date", fromIso)
    .lte("date", toIso);

  if (error) {
    // Tres formas de "la migración no está aplicada", y las tres se tratan
    // igual (el panel pide aplicar el SQL en lugar de pintar un cero falso):
    //   PGRST205 / 42P01 → la tabla no existe.
    //   42703 / PGRST204 → existe, pero sin la columna `plataforma`, o sea que
    //                      está la migración de 2026-06 y no la de 2026-08.
    const pendiente = ["PGRST205", "42P01", "42703", "PGRST204"];
    if (pendiente.includes(error.code)) return { migrationPending: true };
    console.error("[admin/analytics] feature_events (plataforma):", error);
    return null;
  }

  // Un punto por día con las tres cubetas a cero, y encima volcamos lo que
  // haya. Los días sin marcas tienen que salir a cero y no desaparecer, o la
  // gráfica dibujaría una línea continua sobre un hueco real.
  const porFecha = new Map(
    dateRangeInclusive(fromIso, toIso).map((date) => [
      date,
      { date, app: 0, web: 0, legacy: 0 },
    ])
  );
  const totals = { app: 0, web: 0, legacy: 0 };

  for (const fila of data || []) {
    const punto = porFecha.get(fila.date);
    const n = Number(fila.count) || 0;
    // Cubeta desconocida (alguien amplió la allowlist de la RPC y no tocó
    // esto) → a 'legacy', que es literalmente "no lo sé".
    const cubeta = fila.plataforma === "app" || fila.plataforma === "web"
      ? fila.plataforma
      : "legacy";
    if (punto) punto[cubeta] += n;
    totals[cubeta] += n;
  }

  const conocidos = totals.app + totals.web;
  return {
    migrationPending: false,
    series: [...porFecha.values()],
    totals,
    // Reparto sobre lo que SÍ se conoce: meter 'legacy' en el denominador
    // hundiría el porcentaje de la app durante las semanas que la gente tarda
    // en actualizar el APK, y parecería una caída de uso que no ha pasado.
    appShare: conocidos > 0 ? totals.app / conocidos : null,
  };
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
      activeByDate,
      totalSeries,
      finishedByDate,
      retention,
      winRateDistribution,
      hardestCars,
      streakDistribution,
      repescaUsage,
      globalDifficulty,
      rankingUsage,
      plataformas,
    ] = await Promise.all([
      fetchUsers(supabaseAdmin, fromIso),
      fetchActiveUsersByDate(supabaseAdmin, fromIso, toIso),
      fetchTotalPlayersSeries(supabaseAdmin, fromIso, toIso),
      fetchFinishedUsersByDate(supabaseAdmin, fromIso, toIso),
      fetchRetention(supabaseAdmin, fromIso),
      fetchWinRateDistribution(supabaseAdmin, fromIso, toIso),
      fetchHardestCars(supabaseAdmin, fromIso, toIso),
      fetchStreakDistribution(supabaseAdmin),
      fetchRepescaUsage(supabaseAdmin, fromIso, toIso),
      fetchGlobalDifficulty(supabaseAdmin),
      fetchRankingUsage(supabaseAdmin, fromIso, toIso),
      fetchPlataformas(supabaseAdmin, fromIso, toIso),
    ]);

    // AQUÍ se separan las dos poblaciones que user_guesses mezcla desde
    // jul-2026. Sin esto, «DAU (registrados)» contaba anónimos y —peor— la
    // resta total − registrados del «% anónimos» tendía a cero, dando a
    // entender que los anónimos se habían ido cuando solo se habían vuelto
    // invisibles. La verdad de quién es anónimo está en auth.users.is_anonymous,
    // que ya trae fetchUsers.
    const anonIds = users.anonIds || new Set();
    const esRegistrado = (id) => !anonIds.has(id);
    const esAnonimo = (id) => anonIds.has(id);

    const dauSeries = serieDesdeMapa(activeByDate, fromIso, toIso, esRegistrado);
    const dauAnonSeries = serieDesdeMapa(activeByDate, fromIso, toIso, esAnonimo);
    const registeredFinishedSeries = serieDesdeMapa(
      finishedByDate,
      fromIso,
      toIso,
      esRegistrado
    );

    // DAU promedio en el período (excluye el primer día si rango=24h).
    const dauAvg =
      dauSeries.length > 0
        ? dauSeries.reduce((sum, d) => sum + d.count, 0) / dauSeries.length
        : 0;

    // Medias del periodo para la gráfica de composición (total vs registrados
    // vs anónimos). Ambas sobre base "partidas completadas" para que resten.
    const avg = (series) =>
      series.length > 0
        ? series.reduce((sum, d) => sum + d.count, 0) / series.length
        : 0;
    const totalAvg = avg(totalSeries);
    const registeredFinishedAvg = avg(registeredFinishedSeries);
    const dauAnonAvg = avg(dauAnonSeries);

    // `anonIds` es de uso interno (clasificar las series de arriba) y además un
    // Set, que JSON.stringify serializaría como {}. Fuera del payload: el panel
    // no lo necesita y no hay motivo para mandar al cliente la lista de ids.
    const { anonIds: _anonIds, ...usersPayload } = users;

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      range: {
        key: rangeKey,
        label: rangeSpec.label,
        from: fromIso,
        to: toIso,
        days: rangeSpec.days,
      },
      users: usersPayload,
      engagement: {
        dauSeries,
        dauAvg,
        dauAnonSeries,
        dauAnonAvg,
        totalSeries,
        totalAvg,
        registeredFinishedSeries,
        registeredFinishedAvg,
        retention,
        repescaUsage,
        rankingUsage,
        plataformas,
      },
      gameplay: {
        winRateDistribution,
        hardestCars,
        streakDistribution,
      },
      difficulty: globalDifficulty,
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
