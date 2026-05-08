import { supabase } from "../supabaseClient";

const EMPTY_STATS = {
  current_streak: 0,
  max_streak: 0,
  total_wins: 0,
  last_played_date: null,
};

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

export async function getMyStats() {
  const user = await getCurrentUser();

  if (!user) {
    return { user: null, stats: null };
  }

  const { data, error } = await supabase
    .from("stats")
    .select("current_streak, max_streak, total_wins, last_played_date")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;

  if (data) {
    return { user, stats: data };
  }

  const { data: created, error: insertError } = await supabase
    .from("stats")
    .insert({ user_id: user.id })
    .select("current_streak, max_streak, total_wins, last_played_date")
    .single();

  if (insertError) throw insertError;

  return { user, stats: created || EMPTY_STATS };
}

export async function getLeaderboard() {
  const { data, error } = await supabase
    .from("stats")
    .select(`
      user_id,
      current_streak,
      max_streak,
      total_wins,
      profile:profiles (
        username,
        avatar_url
      )
    `)
    .order("max_streak", { ascending: false })
    .order("total_wins", { ascending: false })
    .limit(10);

  if (error) throw error;

  return data.map((row, index) => ({
    rank: index + 1,
    userId: row.user_id,
    username: row.profile?.username || "Piloto anónimo",
    avatarUrl: row.profile?.avatar_url,
    currentStreak: row.current_streak,
    maxStreak: row.max_streak,
    totalWins: row.total_wins,
  }));
}

export async function recordWin() {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const { data, error } = await supabase.rpc("record_daily_win");

  if (error) throw error;

  return data;
}
