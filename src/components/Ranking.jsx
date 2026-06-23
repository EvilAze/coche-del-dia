import { useEffect, useState } from "react";
import { getLeaderboard, getMonthlyLeaderboard } from "../lib/statsService";
import { useEscape } from "../hooks/useEscape";
import { useT } from "../i18n";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";
import AchievementIcon from "./AchievementIcons";
import ScoringHelpModal from "./ScoringHelpModal";
import PublicProfile from "./PublicProfile";
import { track } from "../lib/analytics";
import { TIER_HEX } from "../lib/collectionTier";

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
        rounded-full border border-border bg-bg-tertiary
        text-muted-foreground transition
        hover:border-mint/60 hover:bg-mint/10 hover:text-mint
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
  if (streak >= 4) return { icon: "blaze", bonus: "+3", onFire: true };
  if (streak === 3) return { icon: "spark_double", bonus: "+2", onFire: false };
  return { icon: "spark", bonus: "+1", onFire: false };
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
      <AchievementIcon name={display.icon} size="h-4 w-4" color="text-mint" />
      <span className="text-xs font-semibold text-mint">
        {display.bonus}
      </span>
    </span>
  );
}

// Puesto: el top-3 colorea el NÚMERO en oro/plata/bronce (mismos tonos que los
// tiers del Garaje/Logros — un único idioma en toda la web), SIN redondel: el
// disco relleno pesaba demasiado para lo limpia que es la fila. Del #4 en
// adelante, número en gris.
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

export default function Ranking({ open, onClose, user, onOpenLogin }) {
  const { t } = useT();
  const [state, setState] = useState({
    loading: true,
    players: [],
    error: "",
  });
  // PestaÃ±a activa: "month" (ranking del mes en curso, por defecto para que
  // los reciÃ©n llegados vean un marcador alcanzable) o "all" (histÃ³rico).
  const [tab, setTab] = useState("month");
  const [helpOpen, setHelpOpen] = useState(false);
  // Modal de perfil pÃºblico al clicar una fila del ranking. Guardamos
  // el userId del jugador objetivo; null = cerrado.
  const [openProfileId, setOpenProfileId] = useState(null);
  // userId del usuario actual (logueado), si lo hay. Lo usamos para
  // NO hacer clicable su propia fila â€” ya tiene su MyStats privado.
  const currentUserId = user?.id || null;
  // Mi fila dentro del leaderboard cargado (mismo scope que la pestaña activa,
  // así rank+puntos son coherentes). Si estoy fuera del top visible, la fijamos
  // abajo para que siempre vea dónde estoy.
  const selfRow = currentUserId
    ? state.players.find((p) => p.userId === currentUserId) || null
    : null;

  // Al cerrar el modal, volvemos a la pestaÃ±a mensual para la prÃ³xima apertura.
  useEffect(() => {
    if (!open) setTab("month");
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setState({ loading: true, players: [], error: "" });

    const fetcher = tab === "month" ? getMonthlyLeaderboard : getLeaderboard;
    fetcher()
      .then((players) => {
        if (!cancelled) setState({ loading: false, players, error: "" });
      })
      .catch((err) => {
        // No nos tragamos el error: lo logueamos con la pestaña activa para
        // poder diagnosticar por qué falla el ranking (típicamente un error
        // de PostgREST/Supabase: RPC ausente, relación no encontrada, GRANT
        // revocado…). Antes este catch descartaba `err` y la única señal era
        // el mensaje genérico de la UI, imposible de depurar en producción.
        // Un error de leaderboard no contiene PII ni pistas del coche, así
        // que es seguro consolearlo (CLAUDE.md #8).
        console.error(`[Ranking] fallo cargando "${tab}"`, err);
        if (!cancelled)
          setState({
            loading: false,
            players: [],
            error: t("ranking.errorLoad"),
          });
      });

    return () => {
      cancelled = true;
    };
  }, [open, tab]);

  useEscape(open && !helpOpen, onClose);

  return (
    <>
    <ModalShell
      open={open}
      onClose={onClose}
      backdropClassName="modal-scrim fixed inset-0 z-[80] flex items-center justify-center px-4"
      panelClassName="modal-panel-flat w-full max-w-md p-6"
    >
        {/* X anclada a la esquina de la tarjeta plana (el panel es relative). */}
        <div className="absolute right-4 top-4 z-10">
          <CloseButton onClick={onClose} />
        </div>
        <div className="mb-5 pr-10">
          <p className="text-[11px] font-medium uppercase tracking-wide text-mint">
            {t("ranking.tag")}
          </p>
          <div className="flex items-center gap-2.5">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              {t("ranking.title")}
            </h2>
            <HelpButton onClick={() => setHelpOpen(true)} />
          </div>
        </div>

        {/* Switcher de pestaÃ±as: Este mes / HistÃ³rico. El mensual va primero
            y es el default â€” un reciÃ©n llegado ve un marcador alcanzable. */}
        <div
          role="tablist"
          aria-label={t("ranking.tabsAria")}
          className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-border bg-bg-tertiary p-1"
        >
          {[
            { id: "month", label: t("ranking.tabMonth") },
            { id: "all", label: t("ranking.tabAll") },
          ].map((tabDef) => {
            const active = tab === tabDef.id;
            return (
              <button
                key={tabDef.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(tabDef.id)}
                className={`
                  rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide
                  transition active:scale-[0.98]
                  ${
                    active
                      ? "bg-mint/15 text-mint shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                      : "text-muted-foreground hover:text-foreground"
                  }
                `}
              >
                {tabDef.label}
              </button>
            );
          })}
        </div>

        {state.loading ? (
          <p className="text-sm text-muted-foreground">{t("ranking.loading")}</p>
        ) : state.error ? (
          <p className="text-sm text-red-400">{state.error}</p>
        ) : state.players.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {tab === "month" ? t("ranking.emptyMonth") : t("ranking.empty")}
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <div
              className={`
                grid grid-cols-[1.75rem_minmax(0,1fr)_5rem] bg-bg-tertiary
                px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground
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
                ${user ? "divide-y divide-border" : ""}
                ${user && state.players.length > 5 ? "scrollbar-premium max-h-[22rem] overflow-y-auto" : ""}
                ${!user && state.players.length > 3 ? "max-h-[17.9rem] overflow-hidden sm:max-h-[19rem]" : ""}
              `}
            >
              {state.players.map((player, index) => {
                // Solo usuarios LOGUEADOS pueden abrir perfiles ajenos.
                // Para visitantes anÃ³nimos el ranking es informativo
                // pero no interactivo â€” abrir perfiles requiere estar
                // dentro del juego.
                // AdemÃ¡s: tu propia fila nunca es clicable (tienes
                // MyStats para verte a ti).
                const isSelf = currentUserId && currentUserId === player.userId;
                const isClickable = !!user && !isSelf;
                const RowTag = isClickable ? "button" : "div";
                return (
                  <RowTag
                    key={player.userId}
                    type={RowTag === "button" ? "button" : undefined}
                    onClick={
                      RowTag === "button"
                        ? () => {
                            track("profile_view", { source: "ranking" });
                            setOpenProfileId(player.userId);
                          }
                        : undefined
                    }
                    className={`
                      grid w-full grid-cols-[1.75rem_minmax(0,1fr)_4.25rem]
                      items-center px-3 py-2.5 text-left
                      ${isSelf ? "bg-mint/[0.07]" : "bg-transparent"}
                      ${!user && index < 2 ? "border-b border-border" : ""}
                      ${!user && index === 3 ? "border-t border-border" : ""}
                      ${RowTag === "button" ? "transition hover:bg-white/5 active:scale-[0.99]" : ""}
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
                    <div className="flex items-center">
                      <RankMarker rank={player.rank} />
                    </div>

                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <p className="truncate text-sm font-medium text-foreground">
                          {player.displayName}
                        </p>
                        {isSelf && (
                          <span className="shrink-0 rounded-full bg-mint px-1.5 py-px font-mono text-[8.5px] font-bold uppercase tracking-wider text-mint-foreground">
                            {t("ranking.you")}
                          </span>
                        )}
                        <StreakBadge streak={player.currentStreak} />
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {tab === "month"
                          ? t("ranking.monthWins", { value: player.totalWins })
                          : t("ranking.bestStreak", { value: player.maxStreak })}
                      </p>
                    </div>

                    <div className="text-right">
                      <div className={`text-xl font-bold leading-none tabular-nums ${player.rank === 1 ? "text-gold" : "text-foreground"}`}>
                        {player.totalPoints}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t("ranking.points")}
                      </div>
                    </div>
                  </RowTag>
                );
              })}

              {!user && state.players.length > 3 && (
                <>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent via-[#14181e]/80 to-[#14181e]" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent via-[#14181e]/88 to-[#14181e] sm:hidden" />
                </>
              )}
            </div>

            {selfRow && selfRow.rank > 5 && (
              <div className="border-t border-border-strong">
                <p className="px-3 pb-1 pt-2 text-center text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                  {t("ranking.yourPosition")}
                </p>
                <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_4.25rem] items-center bg-mint/[0.07] px-3 py-2.5 text-left">
                  <div className="flex items-center">
                    <RankMarker rank={selfRow.rank} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate text-sm font-medium text-foreground">
                        {selfRow.displayName}
                      </p>
                      <span className="shrink-0 rounded-full bg-mint px-1.5 py-px font-mono text-[8.5px] font-bold uppercase tracking-wider text-mint-foreground">
                        {t("ranking.you")}
                      </span>
                      <StreakBadge streak={selfRow.currentStreak} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {tab === "month"
                        ? t("ranking.monthWins", { value: selfRow.totalWins })
                        : t("ranking.bestStreak", { value: selfRow.maxStreak })}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold leading-none tabular-nums text-foreground">
                      {selfRow.totalPoints}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t("ranking.points")}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!user && state.players.length > 3 && (
              <div className="bg-gradient-to-b from-black/5 to-black/40 p-4">
                <p className="text-center text-sm text-muted-foreground">
                  {t("ranking.loginPrompt")}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenLogin?.();
                  }}
                  className="
                    mt-3 w-full rounded-lg border border-mint/60 bg-mint/10 px-4 py-2.5
                    text-xs font-semibold uppercase tracking-wide text-mint
                    transition hover:bg-mint/20 active:scale-[0.98]
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
        backdrop y su propia animaciÃ³n de entrada/salida. */}
    <ScoringHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    <PublicProfile
      open={!!openProfileId}
      userId={openProfileId}
      onClose={() => setOpenProfileId(null)}
    />
    </>
  );
}
