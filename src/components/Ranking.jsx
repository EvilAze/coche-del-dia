import { useEffect, useState } from "react";
import { getLeaderboard } from "../hooks/useStats";

export default function Ranking({ open, onClose }) {
  const [state, setState] = useState({ loading: true, players: [], error: "" });

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
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111113] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl tracking-widest text-white">
            Ranking Global
          </h2>
          <button onClick={onClose} className="text-xl text-muted hover:text-white">
            ×
          </button>
        </div>

        {state.loading ? (
          <p className="text-sm text-muted">Cargando...</p>
        ) : state.error ? (
          <p className="text-sm text-red-400">{state.error}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {state.players.map((player) => (
              <div
                key={player.userId}
                className="grid grid-cols-[2rem_2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3"
              >
                <div className="font-display text-xl text-accent">
                  {player.rank}
                </div>

                {player.avatarUrl ? (
                  <img
                    src={player.avatarUrl}
                    alt={player.username}
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">
                    {player.username.slice(0, 1).toUpperCase()}
                  </div>
                )}

                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">
                    {player.username}
                  </p>
                  <p className="text-xs text-muted">
                    {player.totalWins} aciertos
                  </p>
                </div>

                <div className="text-right">
                  <div className="font-display text-2xl text-white">
                    {player.maxStreak}
                  </div>
                  <div className="text-[9px] uppercase tracking-widest text-muted">
                    racha
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
