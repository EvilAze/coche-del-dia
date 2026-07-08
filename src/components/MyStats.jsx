import { useEffect, useState } from "react";
import { getProfileSummary } from "../lib/statsService";
import { signOut } from "../lib/auth";
import { useEscape } from "../hooks/useEscape";
import { useT } from "../i18n";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";
import LanguageStrip from "./LanguageStrip";
import PodiumMedals from "./PodiumMedals";

// Tope de congelados — sincronizado con v_freeze_cap en
// scripts/supabase-streak-freeze.sql. Si cambias uno, cambia el otro.
const FREEZE_CAP = 2;

// ── Iconos line-art (stroke currentColor) ────────────────────────────────
// Coherentes con el sistema de iconos de la app (NO emoji, cross-platform).
// Heredan el color del padre vía currentColor; el tamaño vía className.
const ICO = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function FlameIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <path d="M12 3c-1 4.5-6 7-6 12a6 6 0 0 0 12 0c0-5-5-7.5-6-12z" />
      <path d="M12 10.5c-.5 2.5-3 4-3 7a3 3 0 0 0 6 0c0-3-2.5-4.5-3-7z" strokeWidth="1.2" />
    </svg>
  );
}

function CrownIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <path d="M4 8l4 3.5 4-6.5 4 6.5 4-3.5v9.5H4z" />
      <path d="M4 17.5h16" strokeWidth="1.2" />
    </svg>
  );
}

function ShieldIcon({ className = "h-5 w-5" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <path d="M12 3l7 2.6v5.2c0 4.5-3 7.6-7 9.2-4-1.6-7-4.7-7-9.2V5.6z" />
      <path d="M9 12l2 2 4-4.2" />
    </svg>
  );
}

function LockIcon({ className = "h-3.5 w-3.5" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} strokeWidth="2" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function CarIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <path d="M5 11l1.6-4A2 2 0 0 1 8.5 5.7h7a2 2 0 0 1 1.9 1.3L19 11" />
      <path d="M4 11h16v5H4z" />
      <circle cx="7.5" cy="16.5" r="1.6" />
      <circle cx="16.5" cy="16.5" r="1.6" />
    </svg>
  );
}

function MedalIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <circle cx="12" cy="14" r="6" />
      <path d="M9 9 6.5 3.5M15 9l2.5-5.5" />
    </svg>
  );
}

function TrophyIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <path d="M7 4h10v4.5a5 5 0 0 1-10 0z" />
      <path d="M7 6H5a2.4 2.4 0 0 0 0 4.8h2M17 6h2a2.4 2.4 0 0 1 0 4.8h-2" />
      <path d="M12 13.5v3.5M9.5 20h5M10 17h4v3h-4z" />
    </svg>
  );
}

function ChevronRightIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} strokeWidth="2" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// Avatar circular con inicial sobre disco menta.
function Avatar({ initial }) {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-tinta bg-papel-2">
      <span className="font-bold text-xl text-mint">{initial}</span>
    </div>
  );
}

// Pips de escudos como inventario (lleno = disponible). Dos escudos en vez de
// un número suelto: se lee como "tengo estos", no como interruptor on/off
// (que era la confusión del control anterior).
function ShieldPips({ count }) {
  const { t } = useT();
  const freezes = Math.max(0, Math.min(FREEZE_CAP, count ?? 0));
  return (
    <span
      className="flex items-center gap-1.5"
      role="img"
      aria-label={t("myStats.streakFreezesCount", { count: freezes, max: FREEZE_CAP })}
    >
      {Array.from({ length: FREEZE_CAP }).map((_, i) => (
        <span key={i} className={i < freezes ? "text-mint" : "text-border-strong"}>
          <ShieldIcon className="h-[15px] w-[15px]" />
        </span>
      ))}
    </span>
  );
}

// Fila de la ficha de racha del carnet: icono + etiqueta a la izquierda,
// valor a la derecha. Lee como hoja de specs, no como KPI suelto.
function FichaRow({ icon, label, children, last = false }) {
  return (
    <div
      className={`flex items-center justify-between py-2.5 ${
        last ? "" : "border-b border-border-strong/60"
      }`}
    >
      <span className="flex items-center gap-2.5 text-sm text-foreground/85">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}

// Puerta a un destino (Garaje / Ranking / Logros): icono menta + nombre +
// dato clave + chevron. Es un botón: cierra el perfil y abre el destino real
// (cada número vive en su sitio, el perfil solo es la puerta).
function DoorRow({ icon, label, value, onClick, last = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-ring flex w-full items-center justify-between px-3.5 py-3 text-left transition hover:bg-mint/[0.06] ${
        last ? "" : "border-b border-border-strong/60"
      }`}
    >
      <span className="flex items-center gap-2.5">
        <span className="text-mint">{icon}</span>
        <span className="text-sm font-medium text-foreground">{label}</span>
      </span>
      <span className="flex items-center gap-2.5">
        {value && (
          <span className="text-xs tabular-nums text-muted-foreground">{value}</span>
        )}
        <span className="text-muted-foreground">
          <ChevronRightIcon />
        </span>
      </span>
    </button>
  );
}

export default function MyStats({
  open,
  onClose,
  onSignedOut,
  onOpenAchievements,
  onOpenGarage,
  onOpenRanking,
}) {
  const { t, locale } = useT();
  const [state, setState] = useState({
    loading: true,
    user: null,
    profile: null,
    stats: null,
    points: 0,
    rank: null,
    collection: null,
    achievements: null,
    tier: null,
    error: "",
  });

  useEffect(() => {
    if (!open) return;

    setState((current) => ({ ...current, loading: true, error: "" }));

    getProfileSummary()
      .then((data) => setState({ loading: false, error: "", ...data }))
      .catch(() =>
        setState((current) => ({
          ...current,
          loading: false,
          error: t("myStats.errorLoad"),
        }))
      );
  }, [open]);

  async function handleSignOut() {
    const { error } = await signOut();

    if (error) {
      setState((current) => ({ ...current, error: t("myStats.errorSignOut") }));
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

  // Etiqueta del tier (Bronce/Plata/Oro) localizada; null hasta el primer coche.
  const tierLabel = state.tier?.tier
    ? state.tier.label?.[locale] || state.tier.label?.es
    : null;

  const onStreak = (stats?.current_streak ?? 0) > 0;

  // Cierra el perfil y abre el destino de la puerta.
  function go(opener) {
    onClose?.();
    opener?.();
  }

  // Datos de las puertas (cada uno cae con elegancia si su fuente falló).
  const garageValue = state.collection
    ? state.collection.total
      ? `${state.collection.unlocked} / ${state.collection.total}`
      : `${state.collection.unlocked}`
    : null;
  const rankValue = state.rank?.rank
    ? `#${state.rank.rank} · ${state.points} ${t("myStats.ptsShort")}`
    : state.points > 0
      ? `${state.points} ${t("myStats.ptsShort")}`
      : t("myStats.rankNone");
  const logrosValue = state.achievements
    ? `${state.achievements.unlocked} / ${state.achievements.total}`
    : null;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={t("myStats.title")}
      backdropClassName="modal-scrim fixed inset-0 z-[80] flex items-center justify-center px-4"
      panelClassName="modal-panel-flat flex w-full max-w-sm flex-col p-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("myStats.title")}
        </h2>
        <CloseButton onClick={onClose} />
      </div>

      {state.loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : state.error && !state.user ? (
        <p className="text-sm text-red-400">{state.error}</p>
      ) : !state.user ? (
        <p className="text-sm text-muted-foreground">{t("myStats.promoLogin")}</p>
      ) : (
        <>
          {/* Carnet: identidad + ficha de racha en un solo objeto premium. */}
          <div className="relative overflow-hidden rounded-2xl border border-gold/20 bg-bg-tertiary p-4">
            {/* Hairline de oro: detalle premium discreto. */}
            <div className="absolute inset-x-0 top-0 h-px bg-oro-viejo/50" />

            <div className="flex items-center gap-3">
              <Avatar initial={initial} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="truncate text-lg font-bold text-foreground">{nickname}</p>
                  <span
                    className="shrink-0 text-muted-foreground/50"
                    title={t("myStats.nickPermanent")}
                    aria-label={t("myStats.nickPermanentAria")}
                  >
                    <LockIcon />
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">{email}</p>
              </div>
              {tierLabel && (
                <span className="shrink-0 rounded-full border border-gold/35 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-gold">
                  {tierLabel}
                </span>
              )}
            </div>

            {/* Ficha de racha (en racha · mejor racha · escudo). */}
            <div className="mt-3 border-t border-border pt-1">
              <FichaRow
                icon={
                  <span className={onStreak ? "text-gold" : "text-muted-foreground"}>
                    <FlameIcon />
                  </span>
                }
                label={t("myStats.streakCurrent")}
              >
                <span
                  className={`text-base font-bold tabular-nums ${
                    onStreak ? "text-gold" : "text-muted-foreground"
                  }`}
                >
                  {stats?.current_streak ?? 0}
                </span>
              </FichaRow>

              <FichaRow
                icon={
                  <span className="text-gold">
                    <CrownIcon />
                  </span>
                }
                label={t("myStats.streakBest")}
              >
                <span className="text-base font-bold tabular-nums text-gold">
                  {stats?.max_streak ?? 0}
                </span>
              </FichaRow>

              <FichaRow
                last
                icon={
                  <span className="text-mint">
                    <ShieldIcon className="h-[18px] w-[18px]" />
                  </span>
                }
                label={t("myStats.streakFreezes")}
              >
                <ShieldPips count={stats?.streak_freezes} />
              </FichaRow>
            </div>
          </div>

          {/* Podios mensuales (solo si tiene alguno). */}
          <div className="mt-4 empty:hidden">
            <PodiumMedals userId={state.user?.id} />
          </div>

          {/* Tus destinos: una puerta por sección, con su número clave. */}
          <p className="mb-2 mt-5 px-1 text-xs text-muted-foreground">
            {t("myStats.destinations")}
          </p>
          <div className="overflow-hidden rounded-xl border border-border bg-bg-tertiary">
            <DoorRow
              icon={<CarIcon />}
              label={t("garage.headerTitle")}
              value={garageValue}
              onClick={() => go(onOpenGarage)}
            />
            <DoorRow
              icon={<MedalIcon />}
              label={t("ranking.title")}
              value={rankValue}
              onClick={() => go(onOpenRanking)}
            />
            <DoorRow
              last
              icon={<TrophyIcon />}
              label={t("header.achievements")}
              value={logrosValue}
              onClick={() => go(onOpenAchievements)}
            />
          </div>

          {/* Ajustes: idioma + cerrar sesión, en un pie discreto. */}
          <div className="mt-5 border-t border-border pt-4">
            <LanguageStrip />
          </div>

          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={handleSignOut}
              className="text-xs uppercase tracking-wide text-muted-foreground transition hover:text-red-500"
            >
              {t("common.signOut")}
            </button>
          </div>

          {state.error && (
            <p className="mt-3 text-center text-sm text-red-400">{state.error}</p>
          )}
        </>
      )}
    </ModalShell>
  );
}
