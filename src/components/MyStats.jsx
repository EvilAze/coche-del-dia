import { useEffect, useState } from "react";
import { getMyStats } from "../hooks/useStats";
import { supabase } from "../supabaseClient";
import { useEscape } from "../hooks/useEscape";
import { useT } from "../i18n";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";
import LanguageStrip from "./LanguageStrip";
import PodiumMedals from "./PodiumMedals";

function StatCard({ label, value }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] p-4 text-center transition hover:border-accent/30">
      {/* Hairline dorada superior: detalle premium discreto. */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
      <div className="font-display text-3xl tabular-nums text-accent">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-widest text-muted">
        {label}
      </div>
    </div>
  );
}

// Avatar circular con inicial sobre un disco de degradado dorado.
function Avatar({ initial }) {
  return (
    <div className="relative h-16 w-16 shrink-0">
      <div className="flex h-full w-full items-center justify-center rounded-full border border-accent/25 bg-gradient-to-br from-accent/30 to-accent/[0.04]">
        <span className="font-display text-2xl text-accent">{initial}</span>
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

export default function MyStats({ open, onClose, onSignedOut, onOpenAchievements }) {
  const { t } = useT();
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
          error: t("myStats.errorLoad"),
        })
      );
  }, [open]);

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      setState((current) => ({
        ...current,
        error: t("myStats.errorSignOut"),
      }));
      return;
    }

    onSignedOut?.();
    onClose?.();
  }

  useEscape(open, onClose);

  const stats = state.stats;
  const nickname = state.profile?.display_name || t("myStats.noNickname");
  const email = state.user?.email || "";
  const initial = ((state.profile?.display_name || email || "?").trim()[0] || "?").toUpperCase();

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      backdropClassName="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      panelClassName="flex w-full max-w-sm flex-col rounded-2xl border border-white/10 bg-[#111113] p-5 shadow-2xl"
    >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl tracking-widest text-white">
            {t("myStats.title")}
          </h2>
          <CloseButton onClick={onClose} />
        </div>

        {state.loading ? (
          <p className="text-sm text-muted">{t("common.loading")}</p>
        ) : state.error && !state.user ? (
          <p className="text-sm text-red-400">{state.error}</p>
        ) : !state.user ? (
          <p className="text-sm text-muted">
            {t("myStats.promoLogin")}
          </p>
        ) : (
          <>
            <div className="mb-5 flex items-center gap-4 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.015] p-4">
              <Avatar initial={initial} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="truncate text-xl font-bold text-white">
                    {nickname}
                  </p>
                  <span
                    className="shrink-0 text-muted/50"
                    title={t("myStats.nickPermanent")}
                    aria-label={t("myStats.nickPermanentAria")}
                  >
                    <LockIcon />
                  </span>
                </div>
                <p className="mt-0.5 truncate text-sm text-gray-400">{email}</p>
                {state.error && (
                  <p className="mt-2 text-sm text-red-400">{state.error}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <StatCard label={t("myStats.statStreak")} value={stats.current_streak} />
              <StatCard label={t("myStats.statMaxStreak")} value={stats.max_streak} />
              <StatCard label={t("myStats.statWins")} value={stats.total_wins} />
            </div>

            {/* Podios mensuales (🥇🥈🥉). Solo se renderiza si tiene alguno. */}
            <div className="mt-4 empty:hidden">
              <PodiumMedals userId={state.user?.id} />
            </div>

            {/* Acceso a Logros: vive en su propio destino, no embebido aquí.
                Este botón es el puente desde el perfil. */}
            <button
              type="button"
              onClick={() => { onClose?.(); onOpenAchievements?.(); }}
              className="focus-ring mt-4 flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-accent/40 hover:bg-accent/[0.06]"
            >
              <span className="flex items-center gap-2.5">
                <span className="text-accent">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="9" r="5" />
                    <path d="M8.5 13.5 7 21l5-3 5 3-1.5-7.5" />
                  </svg>
                </span>
                <span className="text-sm font-medium text-white">
                  {t("header.achievements")}
                </span>
              </span>
              <span className="text-muted" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </span>
            </button>

            {/* Selector de idioma: reubicado aquí desde el antiguo popover
                del header. El perfil es el hogar natural de los ajustes. */}
            <div className="mt-5 border-t border-white/10 pt-4">
              <LanguageStrip />
            </div>

            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={handleSignOut}
                className="text-xs uppercase tracking-widest text-muted transition hover:text-red-500"
              >
                {t("common.signOut")}
              </button>
            </div>
          </>
        )}
    </ModalShell>
  );
}
