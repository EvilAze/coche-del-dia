// src/components/DailyStats.jsx
// Estadísticas del día mostradas tras terminar la partida.
// Distribución de intentos en barras horizontales con la posición
// del jugador resaltada en accent + mensaje contextual de percentil.
//
// Diseño: compacto, decorativo, no bloquea el flujo. Si la petición
// falla o hay muy pocas partidas, no se renderiza nada.

import { useEffect, useState } from "react";
import { useT } from "../i18n";

// Mínimo de partidas para que las stats sean significativas.
// Con menos de esto, un "80% de acierto" con 4 jugadores es ruido.
const MIN_GAMES = 5;

// Delay base + stagger entre barras para la animación de crecimiento.
const BAR_BASE_DELAY_MS = 120;
const BAR_STAGGER_MS = 60;

export default function DailyStats({ attempts, won }) {
  const { t } = useT();
  const [stats, setStats] = useState(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      try {
        const res = await fetch("/api/daily-stats");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setStats(data);
        // Doble rAF: primero el browser pinta las barras a width:0%,
        // luego en el siguiente frame seteamos revealed=true y las
        // barras transicionan a su ancho real. Sin el doble rAF,
        // algunos browsers (Safari) fusionan ambos paints y la
        // transición no se ve.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!cancelled) setRevealed(true);
          });
        });
      } catch {
        // Stats son decorativas; fallo silencioso.
      }
    }

    fetchStats();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!stats || stats.totalGames < MIN_GAMES) return null;

  const { distribution, totalGames, winRate } = stats;
  const maxCount = Math.max(...distribution, 1);

  // Percentil: % de jugadores que lo hicieron peor que el actual.
  // Solo para ganadores — un "mejor que el 18%" a un perdedor suena
  // a insulto, no a consuelo.
  let betterThanPct = 0;
  if (won) {
    let worse = 0;
    for (let i = attempts; i < 5; i++) worse += distribution[i];
    worse += stats.losses;
    betterThanPct = Math.round((worse / totalGames) * 100);
  }

  return (
    <div className="mb-4 rounded-xl border border-border/60 bg-bg-secondary/40 p-4 animate-fade-in">
      <p className="mb-3 text-center text-[10px] uppercase tracking-[0.22em] text-muted">
        {t("dailyStats.title")}
      </p>

      <div className="flex flex-col gap-1">
        {distribution.map((count, i) => {
          const attemptNum = i + 1;
          const pct =
            totalGames > 0
              ? Math.round((count / totalGames) * 100)
              : 0;
          // El ancho visual se normaliza al mayor bucket para que la
          // barra más larga ocupe ~100%. Min 6% para que buckets vacíos
          // tengan al menos un sliver visible (evita filas sin barra).
          const barPct =
            maxCount > 0
              ? Math.max((count / maxCount) * 100, 6)
              : 6;
          const isPlayer = won && attempts === attemptNum;

          return (
            <div key={attemptNum} className="flex items-center gap-2">
              <span
                className={`
                  w-3 text-right text-xs tabular-nums
                  ${isPlayer ? "font-bold text-accent" : "text-muted/70"}
                `}
              >
                {attemptNum}
              </span>

              <div className="flex-1 h-[18px] rounded bg-white/[0.04] overflow-hidden">
                <div
                  className={`
                    h-full rounded
                    ${isPlayer ? "bg-accent/80" : "bg-white/[0.10]"}
                  `}
                  style={{
                    width: revealed ? `${barPct}%` : "0%",
                    transition: "width 600ms cubic-bezier(0.4, 0, 0.2, 1)",
                    transitionDelay: `${BAR_BASE_DELAY_MS + i * BAR_STAGGER_MS}ms`,
                  }}
                />
              </div>

              <span
                className={`
                  w-8 text-right text-[11px] tabular-nums
                  ${isPlayer ? "font-semibold text-accent" : "text-muted/60"}
                `}
              >
                {pct}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Resumen: total de partidas + tasa de acierto */}
      <div className="mt-3 flex items-center justify-between text-[10px] tracking-[0.14em] text-muted/60">
        <span>{t("dailyStats.gamesPlayed", { count: totalGames })}</span>
        <span>{t("dailyStats.winRate", { pct: winRate })}</span>
      </div>

      {/* Percentil (solo ganadores con ventaja > 0%) */}
      {won && betterThanPct > 0 && (
        <p className="mt-2 text-center text-[11px] text-accent/70">
          {t("dailyStats.betterThan", { pct: betterThanPct })}
        </p>
      )}
    </div>
  );
}
