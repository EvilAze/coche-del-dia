import { useEffect, useState } from "react";
import { getMyStats } from "../hooks/useStats";

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 text-center">
      <div className="font-display text-3xl text-accent">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-widest text-muted">
        {label}
      </div>
    </div>
  );
}

export default function MyStats({ open, onClose }) {
  const [state, setState] = useState({ loading: true, user: null, stats: null, error: "" });

  useEffect(() => {
    if (!open) return;

    setState({ loading: true, user: null, stats: null, error: "" });

    getMyStats()
      .then(({ user, stats }) => setState({ loading: false, user, stats, error: "" }))
      .catch(() =>
        setState({
          loading: false,
          user: null,
          stats: null,
          error: "No se pudieron cargar tus estadísticas.",
        })
      );
  }, [open]);

  if (!open) return null;

  const stats = state.stats;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111113] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl tracking-widest text-white">
            Mis Estadísticas
          </h2>
          <button onClick={onClose} className="text-xl text-muted hover:text-white">
            ×
          </button>
        </div>

        {state.loading ? (
          <p className="text-sm text-muted">Cargando...</p>
        ) : state.error ? (
          <p className="text-sm text-red-400">{state.error}</p>
        ) : !state.user ? (
          <p className="text-sm text-muted">
            Inicia sesión para guardar tus rachas y estadísticas.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <StatCard label="Racha" value={stats.current_streak} />
            <StatCard label="Máxima" value={stats.max_streak} />
            <StatCard label="Aciertos" value={stats.total_wins} />
          </div>
        )}
      </div>
    </div>
  );
}
