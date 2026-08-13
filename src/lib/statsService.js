import { supabase } from "../supabaseClient";
import { isStreakAlive } from "../lib/dates";
import { collectorTier } from "./collectionTier";
import { countDisplayedAchievements } from "./achievements";

const EMPTY_STATS = {
  current_streak: 0,
  max_streak: 0,
  total_wins: 0,
  total_points: 0,
  last_played_date: null,
};

// La comprobación de frescura de la racha (isStreakAlive) vive ahora en
// src/lib/dates.js — módulo puro y testeable. Ver allí la explicación.

function cleanDisplayName(value) {
  return String(value || "").trim();
}

async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    return null;
  }

  return data.user;
}

export async function getMyProfile(userId) {
  if (!userId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;

  return data;
}

// (Aquí había un `getMyMaxStreak()` para el popover de la racha. El récord
// llega ya dentro de getMyStats, así que era un viaje a `stats` para un dato
// que el llamante tenía delante.)

// Lectura ligera del streak actual para el badge del header. Traemos
// también last_played_date para comprobar si la racha sigue viva — si el
// jugador no entró ayer ni hoy, la racha está rota y mostramos 0 aunque
// la BD aún tenga el valor viejo (se reseteará cuando juegue de nuevo).
export async function getMyStreak(userId) {
  if (!userId) return 0;

  const { data, error } = await supabase
    .from("stats")
    .select("current_streak, last_played_date")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[getMyStreak]", error);
    return 0;
  }

  const streak = data?.current_streak ?? 0;
  if (streak === 0) return 0;

  // Si last_played_date no es hoy ni ayer (Madrid), la racha está rota.
  return isStreakAlive(data?.last_played_date) ? streak : 0;
}

// Mi puesto en la TEMPORADA en curso, para la píldora de estado del header y el
// «parte» del final de partida. Una sola RPC barata: el servidor calcula el
// leaderboard completo pero solo devuelve mi fila (rank + total + movimiento vs
// ayer), así que NO arrastramos las 1000 filas al cliente solo para situar al
// jugador. Devuelve null si no estoy rankeado (sin puntos de la temporada o sin
// nick) → la píldora cae a solo-racha. Nunca lanza: el header no debe romperse
// por esto (mismo criterio defensivo que getMyStreak). p_season_id NULL → la
// temporada actual.
export async function getMySeasonRank(userId) {
  if (!userId) return null;

  const { data, error } = await supabase.rpc("get_my_season_rank", {
    p_user_id: userId,
    p_season_id: null,
  });

  if (error) {
    console.error("[getMySeasonRank]", error);
    return null;
  }

  // La RPC devuelve TABLE (una fila): PostgREST la entrega como array.
  const row = Array.isArray(data) ? data[0] : data;
  const rank = row?.rank ?? null;
  // Sin puesto propio no pintamos puesto (total puede venir aunque rank sea
  // null porque haya otros jugadores, pero a la píldora solo le importa el mío).
  if (!rank || rank < 1) return null;
  // `delta`/`prev_rank` alimentan el «parte de la clasificación» del final de
  // partida (movimiento vs ayer). Sin snapshot de hoy la RPC devuelve prev_rank
  // null → isNew=true → copy neutro. La píldora del header ignora estos campos.
  const prevRank = row?.prev_rank ?? null;
  return {
    rank,
    total: row?.total ?? null,
    delta: row?.delta ?? null,
    isNew: prevRank == null,
    // La DISTANCIA al de arriba (scripts/2026-07-clasificacion-distancia.sql).
    // `?? null` no es defensivo de más: si la base de datos aún no tiene esa
    // migración, la RPC vieja no devuelve estas columnas y la faja simplemente
    // no pinta la línea de distancia. La web nunca depende de ellas.
    points: row?.points ?? null,
    gap: row?.gap ?? null,
  };
}

export async function saveDisplayName(displayName) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Necesitas iniciar sesión.");
  }

  const clean = cleanDisplayName(displayName);

  if (!/^[A-Za-z0-9]{1,12}$/.test(clean)) {
    throw new Error("Usa solo letras y números, máximo 12 caracteres.");
  }

  // EL NICK YA NO ES PERMANENTE (jul-2026). Antes esta función rechazaba
  // cualquier cambio si el perfil ya tenía display_name, y el modal lo avisaba
  // en mayúsculas: «elige con cuidado, será permanente». Era una decisión
  // irreversible exigida a alguien que llevaba cuatro segundos registrado —
  // justo el momento en que menos contexto tiene para tomarla.
  //
  // Lo que protegía se mantiene igual sin el candado: la identidad en la tabla
  // la garantiza el índice UNIQUE de la columna (el 23505 de más abajo), no la
  // inmutabilidad. Un nick libre se puede tomar, exactamente como antes.
  //
  // Único hueco conocido y asumido: al renombrarse, el nick viejo queda libre y
  // otro jugador podría adoptarlo. Con una tabla de bragging rights de un juego
  // diario, el coste de eso es menor que el de la fricción que quitamos; si
  // algún día molesta, el sitio de la solución es la base de datos (cooldown o
  // reserva temporal del nombre liberado), no volver a congelarlo aquí.
  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        display_name: clean,
      },
      { onConflict: "id" }
    )
    .select("id, display_name")
    .single();

  if (error) {
    const errorText = `${error.code || ""} ${error.message || ""} ${error.details || ""}`.toLowerCase();

    const isDuplicate =
      error.code === "23505" ||
      errorText.includes("duplicate") ||
      errorText.includes("unique");

    if (isDuplicate) {
      const duplicateError = new Error("Este nombre ya está en uso. Elige otro.");
      duplicateError.code = "DUPLICATE_DISPLAY_NAME";
      throw duplicateError;
    }

    throw error;
  }

  return data;
}

export async function getMyStats() {
  const user = await getCurrentUser();

  if (!user) {
    return { user: null, profile: null, stats: null };
  }

  const [{ data: stats, error: statsError }, profile] = await Promise.all([
    supabase
      .from("stats")
      .select(
        "current_streak, max_streak, total_wins, total_points, last_played_date, achievements_unlocked"
      )
      .eq("user_id", user.id)
      .maybeSingle(),
    getMyProfile(user.id),
  ]);

  if (statsError) throw statsError;

  // Aplicamos la misma comprobación de frescura que en getMyStreak: si la
  // racha lleva más de un día sin actividad la mostramos como 0.
  const cleanStats = stats ? { ...stats } : { ...EMPTY_STATS };
  if (
    cleanStats.current_streak > 0 &&
    !isStreakAlive(cleanStats.last_played_date)
  ) {
    cleanStats.current_streak = 0;
  }

  return {
    user,
    profile,
    stats: cleanStats,
  };
}

// Total de coches del catálogo (para el "/403" de la puerta del Garaje en el
// Perfil). count exact + head:true → no trae filas, solo el número. Cae a null
// si falla: la UI muestra entonces el nº de coches ganados sin denominador, sin
// romper el modal (mismo criterio defensivo que el resto de lecturas ligeras).
async function getCatalogCount() {
  const { count, error } = await supabase
    .from("cars")
    .select("id", { count: "exact", head: true });

  if (error) {
    console.error("[getCatalogCount]", error);
    return null;
  }

  return count ?? null;
}

// Resumen consolidado para el modal Mi Perfil (carnet + puertas). Parte de
// getMyStats (identidad + racha) y le añade EN PARALELO los datos
// que las "puertas" necesitan, cada uno barato y derivado de fuentes que ya
// existían — sin traer el Garaje entero ni el leaderboard completo:
//   - rank:       getMySeasonRank (RPC que solo devuelve mi fila).
//   - collection: nº de coches ganados (únicos) / total del catálogo.
//   - achievements: conteo ligero de hitos+rachas (sin catálogo).
//   - tier:       rango global de coleccionista derivado del nº ganado.
// El conteo de logros y el tier salen del MISMO wonCount, así que no duplican
// trabajo. Si el usuario no está logueado, devuelve la forma "vacía" de
// getMyStats con los extras a null (la UI muestra el promo de login).
export async function getProfileSummary() {
  const base = await getMyStats();

  if (!base.user) {
    return { ...base, points: 0, rank: null, collection: null, achievements: null, tier: null };
  }

  const maxStreak = base.stats?.max_streak ?? 0;

  // Cada extra cae con elegancia: un fallo en uno NO debe tumbar el carnet
  // (identidad + racha ya vienen de getMyStats). getMySeasonRank/getCatalogCount
  // ya son defensivos; a getMyWonCarIds (que sí lanza) le ponemos red aquí.
  const [rank, wonIds, catalogTotal] = await Promise.all([
    getMySeasonRank(base.user.id),
    getMyWonCarIds().catch(() => []),
    getCatalogCount(),
  ]);

  const wonCount = wonIds.length;

  return {
    ...base,
    points: base.stats?.total_points ?? 0,
    rank, // { rank, total } | null
    collection: { unlocked: wonCount, total: catalogTotal },
    achievements: countDisplayedAchievements({ wonCount, maxStreak }),
    tier: collectorTier(wonCount),
  };
}

export async function getMyWonCarIds() {
  const user = await getCurrentUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("user_guesses")
    .select("car_id")
    .eq("user_id", user.id)
    .eq("status", "won");
  if (error) throw error;
  // Deduplicamos: un mismo coche se puede haber ganado en daily + repesca
  // (raro pero posible). Para logros, "ganado" es ganado, una vez basta.
  return [...new Set((data || []).map((r) => r.car_id))];
}

// Persiste un mapa de logros desbloqueados (delta). El servidor hace
// MERGE no-destructivo: solo añade claves, nunca quita. La frontend
// debe enviar solo desbloqueos NUEVOS (no rebaja, no idempotente
// innecesariamente — es defensa contra payload inflado).
//
// Formato esperado: { "brand_mitsubishi": "gold", "milestone_first": true, ... }
//
// Devuelve el mapa fusionado tras la operación.
export async function persistAchievementUnlocks(unlocksMap) {
  if (!unlocksMap || Object.keys(unlocksMap).length === 0) return null;
  const { data, error } = await supabase.rpc("persist_achievement_unlocks", {
    p_unlocks: unlocksMap,
  });
  if (error) throw error;
  return data;
}

// Lee el perfil público de OTRO usuario (no el actual). Llama a la RPC
// SECURITY DEFINER `get_public_profile` que vive en Supabase. Devuelve
// { profile: {display_name}, stats: {...}, wonCarIds: string[] }.
// La RPC solo expone lo que ya es público (mismos campos que ranking).
export async function getPublicProfile(userId) {
  if (!userId) return null;
  const { data, error } = await supabase.rpc("get_public_profile", {
    p_user_id: userId,
  });
  if (error) throw error;
  return {
    profile: data?.profile ?? null,
    stats: data?.stats ?? null,
    wonCarIds: Array.isArray(data?.wonCarIds) ? data.wonCarIds : [],
    achievementsUnlocked:
      data?.achievementsUnlocked && typeof data.achievementsUnlocked === "object"
        ? data.achievementsUnlocked
        : {},
  };
}

export async function getLeaderboard() {
  // Devolvemos a TODOS los jugadores con puntos > 0 y nickname puesto.
  // El `.limit(1000)` es solo un techo de seguridad para no traer la BD
  // entera si algún día crece mucho; Supabase devuelve por defecto 1000,
  // así que esto es el cap real. La UI (Ranking.jsx) ya hace scroll
  // interno cuando hay más de 5 entradas.
  const { data, error } = await supabase
    .from("stats")
    .select(`
      user_id,
      current_streak,
      max_streak,
      total_wins,
      total_points,
      last_played_date,
      profile:profiles (
        display_name
      )
    `)
    .gt("total_points", 0)
    .order("total_points", { ascending: false })
    .order("max_streak", { ascending: false })
    .limit(1000);

  if (error) throw error;

  // Guard de null: PostgREST puede devolver `data: null` (sin error) en
  // ciertos escenarios; sin esto, `.filter` revienta con TypeError. Mismo
  // criterio defensivo que getSeasonLeaderboard, que ya hacía `(data || [])`.
  return (data || [])
    .filter((row) => row.profile?.display_name)
    .map((row, index) => ({
      rank: index + 1,
      userId: row.user_id,
      displayName: row.profile.display_name,
      // Misma regla de frescura que el header: si no jugó hoy ni ayer
      // (Madrid), la racha está rota aunque la BD aún tenga el valor viejo
      // (se resetea cuando vuelve a jugar). Evita mostrar 🔥 fantasma.
      currentStreak: isStreakAlive(row.last_played_date)
        ? row.current_streak || 0
        : 0,
      maxStreak: row.max_streak || 0,
      totalWins: row.total_wins || 0,
      totalPoints: row.total_points || 0,
    }));
}

// Fecha 'YYYY-MM-DD' en Madrid (misma que usa el ranking para el corte de día).
function todayMadridStr() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Temporada activa (o null si hay hueco entre temporadas). Lectura pública
// directa de `seasons`. La consumen el banner del modal de ranking, el «parte»
// y el ladillo de la faja (label + countdown). Nunca lanza: la UI cae con
// elegancia sin temporada.
//
// MEMOIZADA POR DÍA: son ya cuatro consumidores (masthead, faja, parte, modal) y
// la temporada no cambia dentro de una sesión salvo al cruzar la medianoche de
// Madrid — que es justo lo que distingue la clave. Cacheamos la PROMESA, no el
// resultado: si dos componentes montan en el mismo tick, comparten la petición
// en vuelo en vez de disparar dos. Un fallo no se cachea (se borra la entrada),
// para que el siguiente consumidor pueda reintentar.
let seasonCache = { key: null, promise: null };

export function getCurrentSeason() {
  const today = todayMadridStr();
  if (seasonCache.key === today && seasonCache.promise) return seasonCache.promise;
  const promise = fetchCurrentSeason(today).catch((err) => {
    if (seasonCache.key === today) seasonCache = { key: null, promise: null };
    throw err;
  });
  seasonCache = { key: today, promise };
  return promise;
}

async function fetchCurrentSeason(today) {
  const { data, error } = await supabase
    .from("seasons")
    // `presenta_*` (quién presenta la temporada) tiene GRANT explícito, como el
    // resto de esta lista: `seasons` va con grants por COLUMNA desde las
    // temporadas temáticas, así que pedir aquí una columna sin conceder
    // reventaría la query entera — y con ella el parte y el banner de la tabla.
    .select("id, number, label_es, label_en, presenta_es, presenta_en, starts_at, ends_at")
    .lte("starts_at", today)
    .gte("ends_at", today)
    .maybeSingle();
  if (error) {
    console.error("[getCurrentSeason]", error);
    return null;
  }
  return data;
}

// Ranking de la TEMPORADA en curso. Deriva los puntos base ganados en el rango
// de la temporada desde user_guesses vía la RPC get_season_leaderboard (ver
// scripts/2026-07-temporadas.sql). Mismo shape que getLeaderboard para que
// Ranking.jsx reutilice el render de filas. p_season_id NULL → temporada actual.
export async function getSeasonLeaderboard() {
  const { data, error } = await supabase.rpc("get_season_leaderboard", {
    p_season_id: null,
    p_limit: 1000,
  });

  if (error) throw error;

  return (data || []).map((row) => ({
    rank: row.rank,
    userId: row.user_id,
    displayName: row.display_name,
    // Misma comprobación de frescura que getLeaderboard / el header.
    currentStreak: isStreakAlive(row.last_played_date)
      ? row.current_streak || 0
      : 0,
    maxStreak: row.max_streak || 0,
    totalWins: row.total_wins || 0,
    totalPoints: row.total_points || 0,
  }));
}

// SALÓN DE CAMPEONES: palmarés histórico para la pestaña "Campeones" del
// Ranking. Lee el RPC get_champions (ver scripts/2026-07-salon-campeones.sql):
// temporadas cerradas con podio, cada una con su top-3 + nombre + puntos.
// Devuelve las filas AGRUPADAS por temporada (más reciente primero, ya ordenado
// por el SQL):
//   [{ number, labelEs, labelEn, startsAt, endsAt, podium: [{ rank, userId,
//      displayName, points }] }, ...]
export async function getChampions(limit = 24) {
  const { data, error } = await supabase.rpc("get_champions", { p_limit: limit });
  if (error) throw error;

  // El RPC llega en filas planas (una por medallista); las plegamos por
  // temporada. Map preserva el orden de inserción, que ya viene "temporada
  // desc, rank asc" del SQL, así que no reordenamos en cliente.
  const bySeason = new Map();
  for (const row of data || []) {
    let s = bySeason.get(row.number);
    if (!s) {
      s = {
        number: row.number,
        labelEs: row.label_es,
        labelEn: row.label_en,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        podium: [],
      };
      bySeason.set(row.number, s);
    }
    s.podium.push({
      rank: row.rank,
      userId: row.user_id,
      displayName: row.display_name,
      points: row.points || 0,
    });
  }
  return Array.from(bySeason.values());
}

// Medallas de TEMPORADA (top 1/2/3 de temporadas cerradas) + su tema, para la
// vitrina del perfil. Lee season_podium (público) join seasons por el label.
// Orden por número de temporada desc (más reciente primero) en cliente: ordenar
// por columna embebida en PostgREST es frágil, y son pocas filas.
export async function getSeasonMedals(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from("season_podium")
    .select("rank, points, seasons(number, label_es, label_en, ends_at)")
    .eq("user_id", userId);
  if (error) {
    console.error("[getSeasonMedals]", error);
    return [];
  }
  return (data || [])
    .map((row) => ({
      rank: row.rank,
      points: row.points,
      number: row.seasons?.number ?? null,
      labelEs: row.seasons?.label_es ?? null,
      labelEn: row.seasons?.label_en ?? null,
      endsAt: row.seasons?.ends_at ?? null,
    }))
    .sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
}

// Medallas de podio de un usuario (top 1/2/3 de meses cerrados). Lee la tabla
// pública monthly_podium directamente (SELECT abierto a todos). Devuelve un
// array ordenado del mes más reciente al más antiguo:
//   [{ month: "2026-05-01", rank: 1, points: 87 }, ...]
// `month` es el primer día del mes (string ISO date) — el componente lo
// formatea con Intl según el locale activo.
export async function getMonthlyMedals(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from("monthly_podium")
    .select("month, rank, points")
    .eq("user_id", userId)
    .order("month", { ascending: false });

  if (error) {
    console.error("[getMonthlyMedals]", error);
    return [];
  }

  return (data || []).map((row) => ({
    month: row.month,
    rank: row.rank,
    points: row.points,
  }));
}