import { useEffect, useState } from "react";
import { getMyStats, saveDisplayName } from "../hooks/useStats";
import { supabase } from "../supabaseClient";

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

function EditIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
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

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (!open) return;

    setState({
      loading: true,
      user: null,
      profile: null,
      stats: null,
      error: "",
    });
    setEditingName(false);
    setDraftName("");

    getMyStats()
      .then(({ user, profile, stats }) => {
        setState({ loading: false, user, profile, stats, error: "" });
        setDraftName(profile?.display_name || "");
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

  async function handleSaveName() {
    const cleanName = draftName.trim();

    if (!cleanName) {
      setState((current) => ({
        ...current,
        error: "El nickname no puede estar vacío.",
      }));
      return;
    }

    if (!/^[A-Za-z0-9]{1,12}$/.test(cleanName)) {
      setState((current) => ({
        ...current,
        error: "Usa solo letras y números, máximo 12 caracteres.",
      }));
      return;
    }

    setSavingName(true);
    setState((current) => ({ ...current, error: "" }));

    try {
      const nextProfile = await saveDisplayName(cleanName);

      setState((current) => ({
        ...current,
        profile: nextProfile,
        error: "",
      }));
      setEditingName(false);
      setDraftName(nextProfile.display_name || "");
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error.message || "No se pudo guardar el nickname.",
      }));
    } finally {
      setSavingName(false);
    }
  }

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

  if (!open) return null;

  const stats = state.stats;
  const nickname = state.profile?.display_name || "Sin nickname";
  const email = state.user?.email || "";

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111113] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl tracking-widest text-white">
            Mi Perfil
          </h2>
          <button onClick={onClose} className="text-xl text-muted hover:text-white">
            ×
          </button>
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
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {editingName ? (
                    <div className="flex gap-2">
                      <input
                        value={draftName}
                        maxLength={12}
                        onChange={(e) =>
                          setDraftName(e.target.value.replace(/[^A-Za-z0-9]/g, ""))
                        }
                        className="
                          h-10 min-w-0 flex-1 rounded-lg border border-white/10
                          bg-black/30 px-3 text-sm font-semibold text-white
                          outline-none focus:border-accent
                        "
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={handleSaveName}
                        disabled={savingName}
                        className="
                          h-10 rounded-lg border border-green-400/40 px-3
                          text-sm font-semibold text-green-300 transition
                          hover:bg-green-400/10 disabled:opacity-50
                        "
                      >
                        ✓
                      </button>
                    </div>
                  ) : (
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-2xl font-bold text-white">
                        {nickname}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setDraftName(state.profile?.display_name || "");
                          setEditingName(true);
                          setState((current) => ({ ...current, error: "" }));
                        }}
                        className="shrink-0 text-muted transition hover:text-accent"
                        aria-label="Editar nickname"
                      >
                        <EditIcon />
                      </button>
                    </div>
                  )}

                  <p className="mt-1 truncate text-sm text-gray-400">{email}</p>
                </div>
              </div>

              {state.error && (
                <p className="mt-3 text-sm text-red-400">{state.error}</p>
              )}

              {editingName && (
                <p className="mt-2 text-[10px] uppercase tracking-widest text-muted">
                  Letras y números, máximo 12
                </p>
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
      </div>
    </div>
  );
}