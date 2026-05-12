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

export async function saveDisplayName(displayName) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Necesitas iniciar sesión.");
  }

  const clean = cleanDisplayName(displayName);

  if (!/^[A-Za-z0-9]{1,12}$/.test(clean)) {
    throw new Error("Usa solo letras y números, máximo 12 caracteres.");
  }

  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        display_name: clean,
        username: clean,
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
      .select("current_streak, max_streak, total_wins, total_points, last_played_date")
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

export async function getLeaderboard() {
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
    .limit(50);

  if (error) throw error;

  return data
    .filter((row) => row.profile?.display_name)
    .slice(0, 10)
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