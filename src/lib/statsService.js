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
  streak_freezes: 1, // default de la BD (todos arrancan con 1)
};

// La comprobación de frescura de la racha (isStreakAlive) vive ahora en
// src/lib/dates.js — módulo puro y testeable. Ver allí la explicación.

function cleanDisplayName(value) {
  return String(value || "").trim();
}

export async function getCurrentUser() {
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

// Lectura ligera del récord personal (max_streak) para el popover de la
// racha. Devuelve 0 si la fila no existe o si la query falla — el popover
// debe seguir mostrándose aunque esta query reviente.
export async function getMyMaxStreak() {
  const user = await getCurrentUser();
  if (!user) return 0;

  const { data, error } = await supabase
    .from("stats")
    .select("max_streak")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[getMyMaxStreak]", error);
    return 0;
  }

  return data?.max_streak ?? 0;
}

// Lectura ligera del streak actual para el badge del header. Traemos
// también last_played_date para comprobar si la racha sigue viva — si el
// jugador no entró ayer ni hoy, la racha está rota y mostramos 0 aunque
// la BD aún tenga el valor viejo (se reseteará cuando juegue de nuevo).
export async function getMyStreak(userId) {
  if (!userId) return 0;

  const { data, error } = await supabase
    .from("stats")
    .select("current_streak, last_played_date, streak_freezes")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[getMyStreak]", error);
    return 0;
  }

  const streak = data?.current_streak ?? 0;
  if (streak === 0) return 0;

  // Si last_played_date no es hoy ni ayer (Madrid), la racha está rota —
  // salvo que un congelado cubra el hueco de un día (entonces sigue viva).
  return isStreakAlive(data?.last_played_date, new Date(), data?.streak_freezes ?? 0)
    ? streak
    : 0;
}

// Mi puesto en el ranking MENSUAL (el que el modal abre por defecto), para la
// píldora de estado del header. Una sola RPC barata: el servidor calcula el
// leaderboard completo pero solo devuelve mi fila (rank + total), así que NO
// arrastramos las 1000 filas del leaderboard al cliente solo para situar al
// jugador. Devuelve null si no estoy rankeado (sin puntos del mes o sin nick)
// → la píldora cae a solo-racha. Nunca lanza: el header no debe romperse por
// esto (mismo criterio defensivo que getMyStreak).
export async function getMyMonthlyRank(userId) {
  if (!userId) return null;

  const { data, error } = await supabase.rpc("get_my_monthly_rank", {
    p_user_id: userId,
    p_month: null,
  });

  if (error) {
    console.error("[getMyMonthlyRank]", error);
    return null;
  }

  // La RPC devuelve TABLE (una fila): PostgREST la entrega como array.
  const row = Array.isArray(data) ? data[0] : data;
  const rank = row?.rank ?? null;
  // Sin puesto propio no pintamos puesto (total puede venir aunque rank sea
  // null porque haya otros jugadores, pero a la píldora solo le importa el mío).
  if (!rank || rank < 1) return null;
  return { rank, total: row?.total ?? null };
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

  // El nick es permanente: si ya existe una fila con display_name, rechazamos
  // el cambio. Defensa en la app; el blindaje real debería estar en una RLS
  // policy o trigger en Supabase (UPDATE de display_name solo si era NULL).
  const existing = await getMyProfile(user.id);
  if (existing?.display_name) {
    const lockedError = new Error("Tu nick ya está fijado y no se puede cambiar.");
    lockedError.code = "DISPLAY_NAME_LOCKED";
    throw lockedError;
  }

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
        "current_streak, max_streak, total_wins, total_points, last_played_date, achievements_unlocked, streak_freezes"
      )
      .eq("user_id", user.id)
      .maybeSingle(),
    getMyProfile(user.id),
  ]);

  if (statsError) throw statsError;

  // Aplicamos la misma comprobación de frescura que en getMyStreak: si la
  // racha lleva más de un día sin actividad la mostramos como 0 — salvo que un
  // congelado cubra el hueco de un día.
  const cleanStats = stats ? { ...stats } : { ...EMPTY_STATS };
  if (
    cleanStats.current_streak > 0 &&
    !isStreakAlive(cleanStats.last_played_date, new Date(), cleanStats.streak_freezes ?? 0)
  ) {
    cleanStats.current_streak = 0;
  }

  return {
    user,
    profile,
    stats: cleanStats,
  };
}

// Devuelve los car_ids únicos que el usuario actual ha ganado. Usa la
// sesión del propio cliente (RLS auth.uid()=user_id en user_guesses).
// Si no hay sesión, devuelve [].
// Total de coches del catálogo (para el "/403" de la puerta del Garaje en el
// Perfil). count exact + head:true → no trae filas, solo el número. Cae a null
// si falla: la UI muestra entonces el nº de coches ganados sin denominador, sin
// romper el modal (mismo criterio defensivo que el resto de lecturas ligeras).
export async function getCatalogCount() {
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
// getMyStats (identidad + racha + escudos) y le añade EN PARALELO los datos
// que las "puertas" necesitan, cada uno barato y derivado de fuentes que ya
// existían — sin traer el Garaje entero ni el leaderboard completo:
//   - rank:       getMyMonthlyRank (RPC que solo devuelve mi fila).
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

  const [rank, wonIds, catalogTotal] = await Promise.all([
    getMyMonthlyRank(base.user.id),
    getMyWonCarIds(),
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
  // criterio defensivo que getMonthlyLeaderboard, que ya hacía `(data || [])`.
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

// Ranking MENSUAL del mes en curso. A diferencia de getLeaderboard (que lee
// el acumulado de stats), esto deriva los puntos base ganados este mes desde
// user_guesses vía la RPC get_monthly_leaderboard (ver
// scripts/supabase-monthly-ranking.sql). Devuelve el mismo shape que
// getLeaderboard para que Ranking.jsx reutilice el render de filas.
//
// p_month = NULL → la RPC usa el mes actual en zona Madrid.
export async function getMonthlyLeaderboard() {
  const { data, error } = await supabase.rpc("get_monthly_leaderboard", {
    p_month: null,
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