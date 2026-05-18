import { useEffect, useState } from "react";
import { getLeaderboard } from "../hooks/useStats";
import { useEscape } from "../hooks/useEscape";
import { useT } from "../i18n";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";
import ScoringHelpModal from "./ScoringHelpModal";

function HelpButton({ onClick }) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("ranking.helpButtonAria")}
      title={t("ranking.helpButtonAria")}
      className="
        flex h-7 w-7 shrink-0 items-center justify-center
        rounded-full border border-white/15 bg-white/[0.04]
        text-muted transition
        hover:border-accent/60 hover:bg-accent/10 hover:text-accent
        active:scale-90
      "
    >
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2.5-3 4.5" />
        <path d="M12 18h.01" />
      </svg>
    </button>
  );
}

function getStreakDisplay(streak) {
  if (!streak || streak < 2) return null;
  if (streak >= 4) return { fires: "🔥🔥🔥", bonus: "+3", onFire: true };
  if (streak === 3) return { fires: "🔥🔥", bonus: "+2", onFire: false };
  return { fires: "🔥", bonus: "+1", onFire: false };
}

function StreakBadge({ streak }) {
  const { t } = useT();
  const display = getStreakDisplay(streak);
  if (!display) return null;

  return (
    <span
      className={`
        inline-flex shrink-0 items-center gap-1 leading-none
        ${display.onFire ? "animate-pulse" : ""}
      `}
      title={t("ranking.streakTitle", { count: streak })}
      aria-label={t("ranking.streakAria", { count: streak, bonus: display.bonus })}
    >
      <span className="text-sm tracking-tighter">{display.fires}</span>
      <span className="text-xs font-semibold text-amber-400">
        {display.bonus}
      </span>
    </span>
  );
}

export default function Ranking({ open, onClose, user, onOpenLogin }) {
  const { t } = useT();
  const [state, setState] = useState({
    loading: true,
    players: [],
    error: "",
  });
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    setState({ loading: true, players: [], error: "" });

    getLeaderboard()
      .then((players) => setState({ loading: false, players, error: "" }))
      .catch(() =>
        setState({
          loading: false,
          players: [],
          error: t("ranking.errorLoad"),
        })
      );
  }, [open]);

  useEscape(open && !helpOpen, onClose);

  return (
    <>
    <ModalShell
      open={open}
      onClose={onClose}
      backdropClassName="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
      panelClassName="w-full max-w-md rounded-2xl border border-white/10 bg-[#101014] p-5 shadow-2xl"
    >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-accent">
              {t("ranking.tag")}
            </p>
            <div className="flex items-center gap-2.5">
              <h2 className="font-display text-3xl tracking-widest text-white">
                {t("ranking.title")}
              </h2>
              <HelpButton onClick={() => setHelpOpen(true)} />
            </div>
          </div>

          <CloseButton onClick={onClose} />
        </div>

        {state.loading ? (
          <p className="text-sm text-muted">{t("ranking.loading")}</p>
        ) : state.error ? (
          <p className="text-sm text-red-400">{state.error}</p>
        ) : state.players.length === 0 ? (
          <p className="text-sm text-muted">
            {t("ranking.empty")}
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/10">
            <div
              className={`
                grid grid-cols-[2.5rem_minmax(0,1fr)_5rem] bg-white/[0.04]
                px-3 py-2 text-[11px] uppercase tracking-widest text-muted
                ${user && state.players.length > 5 ? "pr-[calc(0.75rem+6px)]" : ""}
              `}
            >
              <span>{t("ranking.colRank")}</span>
              <span>{t("ranking.colPlayer")}</span>
              <span className="text-right">{t("ranking.colPoints")}</span>
            </div>

            <div
              className={`
                relative
                ${user ? "divide-y divide-white/10" : ""}
                ${user && state.players.length > 5 ? "scrollbar-premium max-h-[22rem] overflow-y-auto" : ""}
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
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate font-display text-xl uppercase tracking-wider text-white">
                        {player.displayName}
                      </p>
                      <StreakBadge streak={player.currentStreak} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {t("ranking.bestStreak", { value: player.maxStreak })}
                    </p>
                  </div>

                  <div className="text-right">
                    <div className="font-display text-3xl leading-none text-white">
                      {player.totalPoints}
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-muted">
                      {t("ranking.points")}
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
                  {t("ranking.loginPrompt")}
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
                  {t("ranking.loginCta")}
                </button>
              </div>
            )}
          </div>
        )}
    </ModalShell>

    {/* Sub-modal hermano (no anidado): ahora cada uno gestiona su propio
        backdrop y su propia animación de entrada/salida. */}
    <ScoringHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
