/// src/components/HeaderSandwich.jsx
// Props: onOpenRanking, onOpenGarage, onOpenProfile, onOpenLogin,
//        user, repescaAlert, streak

import { useEffect, useRef, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { getMyMaxStreak } from "../hooks/useStats";
import { useT } from "../i18n";
import ScoringHelpModal from "./ScoringHelpModal";

const STREAK_MILESTONES = [2, 3, 4, 7, 14, 30, 60, 100, 200, 365];

function nextMilestone(current) {
  return STREAK_MILESTONES.find((m) => m > current) ?? null;
}

// --- Icons ---

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 4h12v5a6 6 0 0 1-12 0V4Z" />
      <path d="M6 6H3a3 3 0 0 0 3 5" />
      <path d="M18 6h3a3 3 0 0 1-3 5" />
      <path d="M12 15v4" />
      <path d="M8 19h8" />
    </svg>
  );
}

function GarageIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 10 12 4l9 6" />
      <path d="M4 10v10" />
      <path d="M20 10v10" />
      <path d="M7 20v-6h10v6" />
      <path d="M9 17h6" />
    </svg>
  );
}

// FlameIcon: SVG en lugar de 🔥. Sustituye al emoji porque el emoji se
// renderiza con la paleta del SO (naranja chillón en Windows, otro en Mac)
// y no respeta currentColor — rompe la coherencia con el resto del header.
function FlameIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

// --- Shared styles ---

const iconBtn = `
  flex h-11 w-11 items-center justify-center rounded-full
  text-muted transition-colors duration-200
  hover:bg-accent/15 hover:text-accent
  active:scale-90
`;

// --- StreakBadge: inline dentro del botón de usuario ---

function StreakBadge({ value }) {
  const prevRef = useRef(value);
  const [pop, setPop] = useState(false);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (value > prev) {
      setPop(true);
      const timer = setTimeout(() => setPop(false), 400);
      return () => clearTimeout(timer);
    }
  }, [value]);

  return (
    <span
      className={`flex items-center gap-1 text-sm font-bold text-accent ${pop ? "animate-pop" : ""}`}
      style={{ lineHeight: 1 }}
    >
      <FlameIcon />
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

// --- StreakPopover: anclado al botón de usuario ---

function StreakPopover({ open, onClose, anchorRef, currentStreak, onOpenScoring, onOpenProfile }) {
  const { t, tn } = useT();
  const popoverRef = useRef(null);
  const [maxStreak, setMaxStreak] = useState(null);
  const [loading, setLoading] = useState(false);

  useEscape(open, onClose);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setLoading(true);
    getMyMaxStreak()
      .then((v) => { if (mounted) { setMaxStreak(v); setLoading(false); } })
      .catch(() => { if (mounted) { setMaxStreak(null); setLoading(false); } });
    return () => { mounted = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target) &&
        anchorRef.current && !anchorRef.current.contains(e.target)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const next = nextMilestone(currentStreak);
  const isRecord = maxStreak !== null && currentStreak > 0 && currentStreak >= maxStreak;

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={t("streak.popoverLabel")}
      className="
        absolute left-0 top-[calc(100%+0.5rem)]
        w-64 rounded-xl border border-accent/30
        bg-[#0f0f12] p-4 shadow-2xl shadow-black/60
        animate-fade-in
      "
    >
      <p className="text-[10px] uppercase tracking-[0.22em] text-accent">
        {t("streak.current")}
      </p>
      <p className="mt-1 font-display text-3xl tracking-wider text-white">
        <span aria-hidden="true">🔥</span> {currentStreak}{" "}
        <span className="text-sm font-normal tracking-normal text-muted">
          {tn("streak.daysShort", currentStreak)}
        </span>
      </p>
      <p className="mt-1 text-xs leading-snug text-muted">
        {isRecord ? t("streak.personalRecord") : t("streak.keepGoing")}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <p className="text-[9px] uppercase tracking-widest text-muted">{t("streak.record")}</p>
          <p className="font-display text-lg tabular-nums text-white">{loading ? "…" : maxStreak ?? "—"}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <p className="text-[9px] uppercase tracking-widest text-muted">{t("streak.nextMilestone")}</p>
          <p className="font-display text-lg tabular-nums text-white">{next ?? "—"}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenScoring}
        className="
          mt-3 flex w-full items-center justify-center gap-1
          rounded-lg border border-white/5 bg-white/[0.02]
          py-2 text-xs font-medium text-muted
          transition-colors duration-150
          hover:bg-white/[0.05] hover:text-accent
        "
      >
        {t("streak.howScoringWorks")} <span aria-hidden="true">→</span>
      </button>

      <button
        type="button"
        onClick={() => { onClose(); onOpenProfile?.(); }}
        className="
          mt-2 flex w-full items-center justify-center gap-1
          rounded-lg border border-white/5 bg-white/[0.02]
          py-2 text-xs font-medium text-muted
          transition-colors duration-150
          hover:bg-white/[0.05] hover:text-accent
        "
      >
        {t("header.profile")} <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

// --- Header principal ---

export default function HeaderSandwich({
  onOpenRanking,
  onOpenGarage,
  onOpenProfile,
  onOpenLogin,
  user,
  repescaAlert = false,
  streak = 0,
}) {
  const { t } = useT();
  const [streakOpen, setStreakOpen] = useState(false);
  const [scoringOpen, setScoringOpen] = useState(false);
  const userBtnRef = useRef(null);

  const showStreak = Boolean(user) && streak > 0;

  function handleUserClick() {
    if (!user) { onOpenLogin?.(); return; }
    if (showStreak) {
      setStreakOpen((v) => !v);
    } else {
      onOpenProfile?.();
    }
  }

  return (
    // ScoringHelpModal fuera del <header> para que su backdrop fixed no quede
    // confinado al containing block que crea backdrop-blur en el header.
    <>
      <header className="sticky top-0 z-50 w-full bg-[#0d0c0a]/90 backdrop-blur-xl">
        <div className="relative mx-auto flex h-14 w-full max-w-md items-center justify-between px-3">

          {/* IZQUIERDA: botón de usuario, siempre presente */}
          <div className="relative z-10">
            <button
              ref={userBtnRef}
              type="button"
              onClick={handleUserClick}
              aria-label={
                !user ? t("header.login")
                : showStreak ? `${t("header.profile")} · racha ${streak}`
                : t("header.profile")
              }
              aria-expanded={showStreak ? streakOpen : undefined}
              aria-haspopup={showStreak ? "dialog" : undefined}
              className={`
                flex h-11 items-center gap-1.5 rounded-full
                text-muted transition-colors duration-200
                hover:bg-accent/15 hover:text-accent active:scale-90
                ${showStreak ? "pl-2 pr-3" : "w-11 justify-center"}
              `}
            >
              <UserIcon />
              {showStreak && <StreakBadge value={streak} />}
            </button>

            <StreakPopover
              open={streakOpen}
              onClose={() => setStreakOpen(false)}
              anchorRef={userBtnRef}
              currentStreak={streak}
              onOpenScoring={() => { setStreakOpen(false); setScoringOpen(true); }}
              onOpenProfile={() => { setStreakOpen(false); onOpenProfile?.(); }}
            />
          </div>

          {/* CENTRO: logo + línea dorada */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center select-none">
            <span
              className="
                translate-y-[1px] whitespace-nowrap font-display
                text-[1.75rem] tracking-widest text-white
                min-[360px]:text-[1.95rem] sm:text-[2.2rem]
              "
            >
              CARGUESSR
            </span>
            <span className="mt-[3px] h-[1.5px] w-14 rounded-full bg-accent/70" />
          </div>

          {/* DERECHA: Garaje + Ranking */}
          <div className="relative z-10 flex items-center">

            <button
              type="button"
              onClick={onOpenGarage}
              aria-label={t("header.garage")}
              title={t("header.garage")}
              className={`relative ${iconBtn}`}
            >
              <GarageIcon />
              {repescaAlert && (
                // Dot de alerta: gold (mismo idioma que el accent) + soft
                // glow para que vibre sin gritar. Posicionado dentro del
                // botón, sobre el "hombro" derecho del icono del garaje
                // (donde el tejado se une al pilar) — se siente atado al
                // icono en lugar de flotando en el borde del botón.
                <span
                  aria-hidden="true"
                  className="
                    pointer-events-none absolute right-2 top-2
                    h-2.5 w-2.5 rounded-full bg-accent
                    shadow-[0_0_6px_rgba(232,200,122,0.65)]
                    ring-2 ring-[#0d0c0a] animate-pulse
                  "
                />
              )}
            </button>

            <button
              type="button"
              onClick={onOpenRanking}
              aria-label={t("header.ranking")}
              title={t("header.ranking")}
              className={iconBtn}
            >
              <TrophyIcon />
            </button>

          </div>
        </div>

        {/* Línea inferior con gradiente dorado sutil */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/25 to-transparent" />
      </header>

      <ScoringHelpModal open={scoringOpen} onClose={() => setScoringOpen(false)} />
    </>
  );
}
