import { supabase } from "../supabaseClient";

const EMPTY_STATS = {
  current_streak: 0,
  max_streak: 0,
  total_wins: 0,
  total_points: 0,
  last_played_date: null,
};

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

// Lectura ligera del streak actual para el badge del header. No traemos
// max_streak ni total_wins porque para el chip basta con current_streak.
// Si la fila no existe (usuario nuevo que aún no ha jugado), devolvemos 0.
export async function getMyStreak(userId) {
  if (!userId) return 0;

  const { data, error } = await supabase
    .from("stats")
    .select("current_streak")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    // No fallar el render del header por esto: si la query revienta, el
    // badge simplemente no aparece. Log para detectar regresiones.
    console.error("[getMyStreak]", error);
    return 0;
  }

  return data?.current_streak ?? 0;
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
        "current_streak, max_streak, total_wins, total_points, last_played_date, achievements_unlocked"
      )
      .eq("user_id", user.id)
      .maybeSingle(),
    getMyProfile(user.id),
  ]);

  if (statsError) throw statsError;

  return {
    user,
    profile,
    stats: stats || EMPTY_STATS,
  };
}

// Devuelve los car_ids únicos que el usuario actual ha ganado. Usa la
// sesión del propio cliente (RLS auth.uid()=user_id en user_guesses).
// Si no hay sesión, devuelve [].
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
      profile:profiles (
        display_name
      )
    `)
    .gt("total_points", 0)
    .order("total_points", { ascending: false })
    .order("max_streak", { ascending: false })
    .limit(1000);

  if (error) throw error;

  return data
    .filter((row) => row.profile?.display_name)
    .map((row, index) => ({
      rank: index + 1,
      userId: row.user_id,
      displayName: row.profile.display_name,
      currentStreak: row.current_streak || 0,
      maxStreak: row.max_streak || 0,
      totalWins: row.total_wins || 0,
      totalPoints: row.total_points || 0,
    }));
}