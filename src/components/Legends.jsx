// src/components/Legends.jsx
// «Leyendas»: la clasificación HISTÓRICA all-time (acumulado de stats.total_points,
// que SÍ incluye el bonus de racha). Antes era la pestaña "Histórico" del modal de
// Ranking; con las Temporadas el ranking principal es la temporada en curso y el
// all-time se repliega aquí, como vista secundaria del perfil — el palmarés del
// veterano. Se abre desde MyStats (usuario logueado), así que no gestiona el caso
// anónimo. Reutiliza las claves i18n de ranking (colRank/colPlayer/…) para no
// duplicar copy.

import { useEffect, useState } from "react";
import { getLeaderboard } from "../lib/statsService";
import { useEscape } from "../hooks/useEscape";
import { useT } from "../i18n";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";
import { TIER_HEX } from "../lib/collectionTier";

// Mismo idioma visual que el modal de temporada: top-3 en oro/plata/bronce.
const RANK_COLOR = { 1: TIER_HEX.gold, 2: TIER_HEX.silver, 3: TIER_HEX.bronze };

function RankMarker({ rank }) {
  const color = RANK_COLOR[rank];
  return (
    <span
      className={`text-lg font-bold tabular-nums ${color ? "" : "text-muted-foreground"}`}
      style={color ? { color } : undefined}
    >
      {rank}
    </span>
  );
}

export default function Legends({ open, onClose }) {
  const { t } = useT();
  const [state, setState] = useState({ loading: true, players: [], error: "" });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ loading: true, players: [], error: "" });
    getLeaderboard()
      .then((players) => {
        if (!cancelled) setState({ loading: false, players, error: "" });
      })
      .catch((err) => {
        console.error("[Legends] fallo cargando histórico", err);
        if (!cancelled)
          setState({ loading: false, players: [], error: t("ranking.errorLoad") });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEscape(open, onClose);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={t("ranking.legends")}
      backdropClassName="modal-scrim fixed inset-0 z-[90] flex items-center justify-center px-4"
      panelClassName="modal-panel-flat w-full max-w-md p-6"
    >
      <div className="absolute right-4 top-4 z-10">
        <CloseButton onClick={onClose} />
      </div>
      <div className="mb-5 pr-10">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gold">
          {t("ranking.legendsSubtitle")}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("ranking.legends")}
        </h2>
      </div>

      {state.loading ? (
        <p className="text-sm text-muted-foreground">{t("ranking.loading")}</p>
      ) : state.error ? (
        <p className="text-sm text-rojo">{state.error}</p>
      ) : state.players.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("ranking.empty")}</p>
      ) : (
        <div className="overflow-hidden rounded-none border border-border">
          <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_5rem] bg-bg-tertiary px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            <span>{t("ranking.colRank")}</span>
            <span>{t("ranking.colPlayer")}</span>
            <span className="text-right">{t("ranking.colPoints")}</span>
          </div>
          <div className="scrollbar-premium max-h-[22rem] divide-y divide-border overflow-y-auto">
            {state.players.map((player) => (
              <div
                key={player.userId}
                className="grid w-full grid-cols-[1.75rem_minmax(0,1fr)_4.25rem] items-center px-3 py-2.5 text-left"
              >
                <div className="flex items-center">
                  <RankMarker rank={player.rank} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {player.displayName}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {t("ranking.bestStreak", { value: player.maxStreak })}
                  </p>
                </div>
                <div className="text-right">
                  <div
                    className={`text-xl font-bold leading-none tabular-nums ${
                      player.rank === 1 ? "text-gold" : "text-foreground"
                    }`}
                  >
                    {player.totalPoints}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t("ranking.points")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
