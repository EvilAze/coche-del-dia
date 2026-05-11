import { useEffect, useState } from "react";
import { getLeaderboard } from "../hooks/useStats";

export default function Ranking({ open, onClose, user, onOpenLogin }) {
  const [state, setState] = useState({
    loading: true,
    players: [],
    error: "",
  });

  useEffect(() => {
    if (!open) return;

    setState({ loading: true, players: [], error: "" });

    getLeaderboard()
      .then((players) => setState({ loading: false, players, error: "" }))
      .catch(() =>
        setState({
          loading: false,
          players: [],
          error: "No se pudo cargar el ranking.",
        })
      );
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#101014] p-5 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-accent">
              Arcade Board
            </p>
            <h2 className="font-display text-3xl tracking-widest text-white">
              Ranking
            </h2>
          </div>

          <button
            onClick={onClose}
            className="text-2xl leading-none text-muted hover:text-white"
          >
            ×
          </button>
        </div>

        {state.loading ? (
          <p className="text-sm text-muted">Cargando ranking...</p>
        ) : state.error ? (
          <p className="text-sm text-red-400">{state.error}</p>
        ) : state.players.length === 0 ? (
          <p className="text-sm text-muted">
            Todavía no hay pilotos con nickname.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/10">
            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_5rem] bg-white/[0.04] px-3 py-2 text-[10px] uppercase tracking-widest text-muted">
              <span>#</span>
              <span>Piloto</span>
              <span className="text-right">Wins</span>
            </div>

            <div
              className={`
                relative
                ${user ? "divide-y divide-white/10" : ""}
                ${!user && state.players.length > 3 ? "max-h-[17.9rem] overflow-hidden sm:max-h-[19rem]" : ""}
              `}
            >
              {state.players.map((player, index) => (
                <div
                  key={player.userId}
                  className={`
                    grid grid-cols-[2.5rem_minmax(0,1fr)_5rem]
                    items-center px-3 py-3 bg-black/10
                    ${!user && index < 2 ? "border-b border-white/10" : ""}
                    ${!user && index === 3 ? "border-t border-white/20" : ""}
                  `}
                  style={
                    !user && index > 2
                      ? {
                          filter: "blur(1.2px)",
                          opacity: 0.62,
                        }
                      : undefined
                  }
                >
                  <div className="font-display text-2xl text-accent">
                    {player.rank}
                  </div>

                  <div className="min-w-0">
                    <p className="truncate font-display text-xl uppercase tracking-wider text-white">
                      {player.displayName}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      Mejor racha: {player.maxStreak} 🔥
                    </p>
                  </div>

                  <div className="text-right">
                    <div className="font-display text-3xl leading-none text-white">
                      {player.totalWins}
                    </div>
                    <div className="text-[9px] uppercase tracking-widest text-muted">
                      aciertos
                    </div>
                  </div>
                </div>
              ))}

              {!user && state.players.length > 3 && (
                <>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent via-[#101014]/80 to-[#101014]" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent via-[#101014]/88 to-[#101014] sm:hidden" />
                </>
              )}
            </div>

            {!user && state.players.length > 3 && (
              <div className="bg-gradient-to-b from-black/5 to-black/40 p-4">
                <p className="text-center text-sm text-muted">
                  Inicia sesion para ver la tabla completa y tu posicion actual.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenLogin?.();
                  }}
                  className="
                    mt-3 w-full rounded-lg border border-accent/60 bg-accent/10 px-4 py-2.5
                    text-xs font-semibold uppercase tracking-[0.12em] text-accent
                    transition hover:bg-accent/20 active:scale-[0.98]
                  "
                >
                  Unirme a la competicion
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
