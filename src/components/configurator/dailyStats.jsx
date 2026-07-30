// src/components/configurator/dailyStats.jsx
// Estadísticas del día (datos REALES de /api/daily-stats). Un único fetch (hook)
// alimenta las dos lecturas: la distribución de intentos, que se pinta como
// sección «Hoy en el mundo», y el percentil «mejor que el X%», que ya no tiene
// componente propio — viaja en el pie de la partida del EndScreen.

import { useEffect, useState } from "react";
import { useT } from "../../i18n";

// Mínimo de partidas para que el dato sea significativo (igual que producción).
const MIN_GAMES = 5;

// `enabled` (default true, retrocompatible con EndScreen): el Configurator lo
// gatea a "partida cerrada" — pedir la distribución ANTES de terminar filtraría
// la dificultad del día a quien aún juega (spec §3 del rediseño prensa).
export function useDailyStats(attempts, won, enabled = true) {
  const [stats, setStats] = useState(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
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
    // `enabled` en deps: si la partida termina en sesión (false→true), el
    // fetch debe dispararse entonces — con [] se quedaría apagado para siempre.
  }, [enabled]);

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
// SIN TÍTULO PROPIO: lo pone el llamante con un `.prensa-ladillo`. Lo traía
// dentro («Hoy en el mundo») y en el Configurator caía justo debajo de otro
// encabezado —«La estadística del día»—, así que la sección se anunciaba dos
// veces seguidas con dos frases distintas para el mismo bloque.
export function Distribution({ data, attempts, won }) {
  const { t } = useT();
  if (!data.ready) return null;
  const { distribution, totalGames, winRate, maxCount, revealed } = data;
  return (
    <div className="cdd-dist-card">
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
                  style={{ width: barPct + "%", transform: revealed ? "scaleX(1)" : "scaleX(0)", transformOrigin: "left", transitionDelay: 120 + i * 60 + "ms" }}
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

// (Aquí vivía `Percentile`, el remate «mejor que el X% de hoy» como bloque
// propio. El dato sigue vivo —`betterThanPct` del hook— pero lo pinta el pie de
// la partida del EndScreen, en la misma línea que el recuento de intentos: es la
// segunda mitad de la misma frase, no un párrafo aparte.)
