// src/components/configurator/dailyStats.jsx
// Estadísticas del día (datos REALES de /api/daily-stats) re-vestidas al sistema
// menta del panel. Misma lógica que el DailyStats de producción: distribución de
// intentos + percentil "mejor que el X% de hoy" (solo ganadores). Un único fetch
// (hook) alimenta las dos piezas: la distribución (pestaña FICHA) y el percentil
// (zona COMPARTIR, como remate del momento de presumir).

import { useEffect, useState } from "react";
import { useT } from "../../i18n";

// Mínimo de partidas para que el dato sea significativo (igual que producción).
const MIN_GAMES = 5;

export function useDailyStats(attempts, won) {
  const [stats, setStats] = useState(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/daily-stats");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setStats(data);
        // Doble rAF: las barras parten de width:0 y transicionan al ancho real.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => { if (!cancelled) setRevealed(true); })
        );
      } catch {
        // Stats decorativas: fallo silencioso.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!stats || stats.totalGames < MIN_GAMES) return { ready: false };

  const { distribution, totalGames, winRate } = stats;
  const maxCount = Math.max(...distribution, 1);

  // Percentil = % de jugadores que lo hicieron PEOR. Solo para ganadores.
  let betterThanPct = 0;
  if (won) {
    let worse = 0;
    for (let i = attempts; i < 5; i++) worse += distribution[i];
    worse += stats.losses;
    betterThanPct = Math.round((worse / totalGames) * 100);
  }

  return { ready: true, distribution, totalGames, winRate, maxCount, betterThanPct, revealed };
}

// Barras de distribución de intentos (1–5) con la fila del jugador resaltada.
export function Distribution({ data, attempts, won }) {
  const { t } = useT();
  if (!data.ready) return null;
  const { distribution, totalGames, winRate, maxCount, revealed } = data;
  return (
    <div className="cdd-dist-card">
      <p className="cdd-mono cdd-dist-title">{t("dailyStats.title")}</p>
      <div className="cdd-dist">
        {distribution.map((count, i) => {
          const n = i + 1;
          const pct = totalGames > 0 ? Math.round((count / totalGames) * 100) : 0;
          const barPct = maxCount > 0 ? Math.max((count / maxCount) * 100, 6) : 6;
          const me = won && attempts === n;
          return (
            <div key={n} className="cdd-dist-row">
              <span className={"cdd-dist-n" + (me ? " me" : "")}>{n}</span>
              <div className="cdd-dist-track">
                <div
                  className={"cdd-dist-bar" + (me ? " me" : "")}
                  style={{ width: revealed ? barPct + "%" : "0%", transitionDelay: 120 + i * 60 + "ms" }}
                />
              </div>
              <span className={"cdd-dist-pct" + (me ? " me" : "")}>{pct}%</span>
            </div>
          );
        })}
      </div>
      <div className="cdd-dist-foot">
        <span>{t("dailyStats.gamesPlayed", { count: totalGames })}</span>
        <span>{t("dailyStats.winRate", { pct: winRate })}</span>
      </div>
    </div>
  );
}

// Remate share-bait: "MEJOR QUE EL X% DE HOY" (solo ganadores con ventaja real).
export function Percentile({ data, won }) {
  const { t } = useT();
  if (!data.ready || !won || data.betterThanPct <= 0) return null;
  return <div className="cdd-percentile">{t("dailyStats.betterThan", { pct: data.betterThanPct })}</div>;
}
