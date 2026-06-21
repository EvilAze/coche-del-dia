// api/daily-stats.js
// Estadísticas agregadas del día actual: distribución de intentos,
// tasa de acierto y total de partidas. Endpoint público (sin auth),
// consumido por el componente DailyStats tras terminar la partida.

import { getSupabaseAdmin } from "./_lib/supabase.js";
import { todayInMadrid } from "./_lib/date.js";
import { methodGuard, applyCors } from "./_lib/http.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return; // preflight OPTIONS / headers CORS
  if (methodGuard(req, res, "GET")) return;

  try {
    const today = todayInMadrid();
    const { data, error } = await getSupabaseAdmin()
      .from("daily_stats")
      .select("*")
      .eq("date", today)
      .maybeSingle();

    if (error) {
      console.error("[daily-stats]", error);
      return res.status(500).json({ error: "Failed to fetch stats" });
    }

    // Si no hay datos aún (nadie ha terminado hoy), devolvemos zeros.
    if (!data) {
      return res.status(200).json({
        totalGames: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        distribution: [0, 0, 0, 0, 0],
        averageAttempts: 0,
      });
    }

    const distribution = [
      data.attempt_1,
      data.attempt_2,
      data.attempt_3,
      data.attempt_4,
      data.attempt_5,
    ];

    const winRate =
      data.total_games > 0
        ? Math.round((data.wins / data.total_games) * 100)
        : 0;

    // Media de intentos entre los que acertaron.
    const totalAttempts = distribution.reduce(
      (sum, count, i) => sum + count * (i + 1),
      0
    );
    const averageAttempts =
      data.wins > 0 ? +(totalAttempts / data.wins).toFixed(1) : 0;

    // Cache corto: 30 s en CDN, revalidación stale 5 min. Las stats
    // cambian con cada partida pero no necesitan ser en tiempo real —
    // un retraso de 30 s es imperceptible para el usuario.
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=30, stale-while-revalidate=300"
    );

    return res.status(200).json({
      totalGames: data.total_games,
      wins: data.wins,
      losses: data.losses,
      winRate,
      distribution,
      averageAttempts,
    });
  } catch (err) {
    console.error("[daily-stats] UNCAUGHT:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}
