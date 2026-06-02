/// src/components/HeaderSandwich.jsx
// Props: onOpenRanking, onOpenGarage, onOpenProfile, onOpenLogin,
//        user, repescaAlert, streak

import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { haptic } from "../lib/haptics";

// --- Icons ---
// Conjunto rediseñado para máxima coherencia visual.
// Filosofía:
// - Mismo peso de línea (strokeWidth="1.75" para un toque elegante pero legible).
// - Misma ocupación de la "caja" (bounding box visual equilibrado).
// - Geometría tranquila, curvas suaves, cero detalles superfluos.

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20c0-3.5 3.5-6 7-6s7 2.5 7 6" />
    </svg>
  );
}

function PodiumIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="13" width="5" height="8" rx="1" />
      <rect x="9" y="6" width="6" height="15" rx="1" />
      <rect x="16" y="15" width="5" height="6" rx="1" />
    </svg>
  );
}

function GarageIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 10L12 4l9 6" />
      <path d="M5 10v11h14V10" />
      <path d="M9 21v-7h6v7" />
      <path d="M9 17.5h6" strokeWidth="1" />
    </svg>
  );
}

function MedalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="5" />
      <path d="M8.21 13.89 7 22l5-3 5 3-1.21-8.11" />
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
  focus-ring
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

// --- Header principal ---

export default function HeaderSandwich({
  onOpenRanking,
  onOpenGarage,
  onOpenProfile,
  onOpenLogin,
  user,
  repescaAlert = false,
  streak = 0,
  date = "",
}) {
  const { t } = useT();

  // Auto-hide del header: se oculta al hacer scroll hacia ABAJO (libera aire
  // para el contenido) y reaparece al SUBIR (la navegación vuelve a un toque).
  // Patrón premium tipo app nativa. Throttle con rAF; umbral para no ocultarse
  // pegado al top; delta mínimo para evitar jitter.
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (Math.abs(y - lastY) >= 4) {
          if (y > lastY && y > 80) setHidden(true);
          else if (y < lastY) setHidden(false);
          lastY = y;
        }
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const showStreak = Boolean(user) && streak > 0;

  // Click del botón de usuario: atajo directo. Logueado → abre el perfil;
  // anónimo → abre el modal de login. El selector de idioma vive ahora
  // dentro de esos dos modales (ver LanguageStrip en MyStats y en el modal
  // de login de App), así que ya no necesitamos un popover intermedio.
  function handleUserClick() {
    haptic.impactLight();
    if (user) onOpenProfile?.();
    else onOpenLogin?.();
  }

  return (
    <header
      className={`
        sticky top-0 z-50 w-full bg-[#0d0c0a]/90 backdrop-blur-xl
        transition-[transform,opacity] duration-300 ease-out
        ${hidden
          ? "pointer-events-none opacity-0 motion-safe:-translate-y-full"
          : "translate-y-0 opacity-100"}
      `}
    >
      <div className="relative mx-auto flex w-full max-w-md items-center justify-between gap-3 px-3 py-2.5">

        {/* MARCA: wordmark + fecha, a la izquierda. Una sola línea con las
            acciones a la derecha → header compacto, sin hueco muerto. */}
        <div className="min-w-0">
          {/* Sheen metálico contenido (champán → oro → oro oscuro). Tamaño de
              wordmark (no hero): convive con las acciones en la misma fila. */}
          <h1 className="truncate bg-gradient-to-b from-[#fbf1d4] via-accent to-accent-dark bg-clip-text font-display text-2xl leading-none tracking-wider text-transparent min-[380px]:text-3xl">
            {t("app.title")}
          </h1>
          {date && (
            <p className="mt-1 truncate text-[10px] uppercase tracking-[0.2em] text-muted">
              {date}
            </p>
          )}
        </div>

        {/* ACCIONES: usuario (+racha), garaje, ranking — todas visibles. */}
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={handleUserClick}
            aria-label={
              !user ? t("header.login")
              : showStreak ? `${t("header.profile")} · racha ${streak}`
              : t("header.profile")
            }
            className={`
              focus-ring
              flex h-11 items-center gap-1.5 rounded-full
              text-muted transition-colors duration-200
              hover:bg-accent/15 hover:text-accent active:scale-90
              ${showStreak ? "pl-2 pr-3" : "w-11 justify-center"}
            `}
          >
            <UserIcon />
            {showStreak && <StreakBadge value={streak} />}
          </button>

          <button
            type="button"
            onClick={() => { haptic.impactLight(); onOpenGarage?.(); }}
            aria-label={t("header.garage")}
            title={t("header.garage")}
            className={`relative ${iconBtn}`}
          >
            <GarageIcon />
            {repescaAlert && (
              // Dot de alerta: gold + soft glow, atado al "hombro" del icono.
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
            onClick={() => { haptic.impactLight(); onOpenRanking?.(); }}
            aria-label={t("header.ranking")}
            title={t("header.ranking")}
            className={iconBtn}
          >
            <PodiumIcon />
          </button>
        </div>
      </div>

      {/* Línea inferior con gradiente dorado sutil */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/25 to-transparent" />
    </header>
  );
}
