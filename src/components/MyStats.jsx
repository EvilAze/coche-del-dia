import { useEffect, useState } from "react";
import { getMyStats } from "../hooks/useStats";
import { supabase } from "../supabaseClient";
import { useEscape } from "../hooks/useEscape";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";

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

function LockIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export default function MyStats({ open, onClose, onSignedOut }) {
  const [state, setState] = useState({
    loading: true,
    user: null,
    profile: null,
    stats: null,
    error: "",
  });

  useEffect(() => {
    if (!open) return;

    setState({
      loading: true,
      user: null,
      profile: null,
      stats: null,
      error: "",
    });

    getMyStats()
      .then(({ user, profile, stats }) => {
        setState({ loading: false, user, profile, stats, error: "" });
      })
      .catch(() =>
        setState({
          loading: false,
          user: null,
          profile: null,
          stats: null,
          error: "No se pudieron cargar tus estadísticas.",
        })
      );
  }, [open]);

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      setState((current) => ({
        ...current,
        error: "No se pudo cerrar sesión.",
      }));
      return;
    }

    onSignedOut?.();
    onClose?.();
  }

  useEscape(open, onClose);

  const stats = state.stats;
  const nickname = state.profile?.display_name || "Sin nickname";
  const email = state.user?.email || "";

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      backdropClassName="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      panelClassName="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111113] p-5 shadow-2xl"
    >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl tracking-widest text-white">
            Mi Perfil
          </h2>
          <CloseButton onClick={onClose} />
        </div>

        {state.loading ? (
          <p className="text-sm text-muted">Cargando...</p>
        ) : state.error && !state.user ? (
          <p className="text-sm text-red-400">{state.error}</p>
        ) : !state.user ? (
          <p className="text-sm text-muted">
            Inicia sesión para guardar tus rachas y estadísticas.
          </p>
        ) : (
          <>
            <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-2xl font-bold text-white">
                    {nickname}
                  </p>
                  <span
                    className="shrink-0 text-muted/60"
                    title="Tu nick es permanente"
                    aria-label="Nick permanente"
                  >
                    <LockIcon />
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-gray-400">{email}</p>
              </div>

              {state.error && (
                <p className="mt-3 text-sm text-red-400">{state.error}</p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Racha" value={stats.current_streak} />
              <StatCard label="Máxima" value={stats.max_streak} />
              <StatCard label="Aciertos" value={stats.total_wins} />
            </div>

            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={handleSignOut}
                className="text-xs uppercase tracking-widest text-muted transition hover:text-red-500"
              >
                Cerrar sesión
              </button>
            </div>
          </>
        )}
    </ModalShell>
  );
}