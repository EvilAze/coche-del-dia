/// src/components/HeaderSandwich.jsx
// Variante experimental del Header. Propuesta de UI:
//   - Izquierda: chip de racha (clickable). Si el usuario tiene racha > 0,
//     se muestra como un "incentivo" con 🔥 N. Si está logueado pero sin
//     racha, se muestra un mensaje sutil de "Empieza tu racha". Si no hay
//     sesión, se oculta para no robar protagonismo al sandwich.
//   - Centro: CARGUESSR (igual que el Header original).
//   - Derecha: botón sandwich que despliega un menú con Garaje, Ranking y
//     Perfil/Iniciar sesión. El punto ámbar de repesca se promueve al
//     propio botón sandwich cuando hay alerta, para no perder el aviso al
//     cerrar el menú.

import { useEffect, useRef, useState } from "react";
import { useEscape } from "../hooks/useEscape";
import { getMyMaxStreak } from "../hooks/useStats";
import ScoringHelpModal from "./ScoringHelpModal";

// Hitos motivacionales que mostramos como "próximo objetivo" en el popover.
// Los 3 primeros (2, 3, 4) son los que dan bonus de puntos según
// ScoringHelpModal; el resto son metas largas sin bonus, solo bragging.
const STREAK_MILESTONES = [2, 3, 4, 7, 14, 30, 60, 100, 200, 365];

function nextMilestone(current) {
  return STREAK_MILESTONES.find((m) => m > current) ?? null;
}

function UserIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
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
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 10 12 4l9 6" />
      <path d="M4 10v10" />
      <path d="M20 10v10" />
      <path d="M7 20v-6h10v6" />
      <path d="M9 17h6" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6l-12 12" />
    </svg>
  );
}

const iconBtn = `
  flex h-11 w-11 items-center justify-center rounded-full
  text-muted transition-colors duration-200
  hover:bg-accent/10 hover:text-accent
  active:scale-90
`;

// Chip de racha: pill con borde sutil dorado para sugerir "logro". Al pasar
// el ratón muestra el mensaje completo como title; en pantalla solo se ve
// 🔥 N para que ocupe poco. Animación pop al subir.
const StreakChip = function StreakChip({ value, onClick, buttonRef, expanded }) {
  const prevRef = useRef(value);
  const [pop, setPop] = useState(false);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (value > prev) {
      setPop(true);
      const t = setTimeout(() => setPop(false), 400);
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={`Racha de ${value} días. Ver detalles.`}
      aria-expanded={expanded}
      aria-haspopup="dialog"
      title={`Llevas ${value} día${value === 1 ? "" : "s"} de racha`}
      className={`
        flex h-9 items-center gap-1.5 rounded-full
        border border-accent/40 bg-accent/10
        pl-2 pr-3 text-sm font-bold text-accent
        transition-all duration-200
        hover:bg-accent/20 hover:border-accent/70
        active:scale-95
        ${pop ? "animate-pop" : ""}
      `}
      style={{ lineHeight: 1 }}
    >
      <span aria-hidden="true" className="text-[1rem]">🔥</span>
      <span className="tabular-nums">{value}</span>
    </button>
  );
};

// Popover anclado al chip de racha. Muestra estado personal (récord,
// próximo hito) + un mensaje motivacional + atajo al modal de puntos.
// No duplica la tabla de puntos: deja ese contenido en ScoringHelpModal.
function StreakPopover({ open, onClose, anchorRef, currentStreak, onOpenScoring }) {
  const popoverRef = useRef(null);
  const [maxStreak, setMaxStreak] = useState(null);
  const [loading, setLoading] = useState(false);

  useEscape(open, onClose);

  // Fetch lazy del récord solo al abrir. Si el usuario abre y cierra varias
  // veces seguidas, refrescamos cada vez — barato y evita stale data si la
  // partida acaba de subir la racha.
  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setLoading(true);
    getMyMaxStreak()
      .then((v) => {
        if (mounted) {
          setMaxStreak(v);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setMaxStreak(null);
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [open]);

  // Cierre por click fuera. Excluimos al ancla (el chip) para no entrar en
  // un toggle-cancel-toggle al pulsar el propio botón.
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const next = nextMilestone(currentStreak);
  const isRecord =
    maxStreak !== null && currentStreak > 0 && currentStreak >= maxStreak;

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Detalles de tu racha"
      className="
        absolute left-0 top-[calc(100%+0.5rem)]
        w-64 rounded-xl border border-accent/30
        bg-[#0f0f12] p-4 shadow-2xl shadow-black/60
        animate-fade-in
      "
    >
      <p className="text-[10px] uppercase tracking-[0.22em] text-accent">
        Racha en curso
      </p>
      <p className="mt-1 font-display text-3xl tracking-wider text-white">
        <span aria-hidden="true">🔥</span> {currentStreak}{" "}
        <span className="text-sm font-normal tracking-normal text-muted">
          día{currentStreak === 1 ? "" : "s"}
        </span>
      </p>
      <p className="mt-1 text-xs leading-snug text-muted">
        {isRecord
          ? "¡Es tu récord personal! No la pierdas."
          : "Sigue así, no la pierdas."}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <p className="text-[9px] uppercase tracking-widest text-muted">
            Récord
          </p>
          <p className="font-display text-lg tabular-nums text-white">
            {loading ? "…" : maxStreak ?? "—"}
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <p className="text-[9px] uppercase tracking-widest text-muted">
            Próximo hito
          </p>
          <p className="font-display text-lg tabular-nums text-white">
            {next ?? "—"}
          </p>
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
        Cómo funcionan los puntos
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

function MenuItem({ icon, label, onClick, alert = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        relative flex w-full items-center gap-3 rounded-lg
        px-3 py-2.5 text-left text-sm font-medium text-white/90
        transition-colors duration-150
        hover:bg-accent/10 hover:text-accent
        active:scale-[0.98]
      "
    >
      <span className="flex h-5 w-5 items-center justify-center text-muted">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      {alert && (
        <span
          aria-hidden="true"
          className="
            h-2 w-2 rounded-full bg-amber-500 animate-pulse
          "
        />
      )}
    </button>
  );
}

export default function HeaderSandwich({
  onOpenRanking,
  onOpenGarage,
  onOpenProfile,
  onOpenLogin,
  user,
  repescaAlert = false,
  streak = 0,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [streakOpen, setStreakOpen] = useState(false);
  const [scoringOpen, setScoringOpen] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const chipRef = useRef(null);

  const showStreak = Boolean(user) && streak > 0;

  useEscape(menuOpen, () => setMenuOpen(false));

  // Cierra el dropdown si el usuario hace click fuera. Usamos mousedown
  // para que la acción cierre antes que un click en otro elemento (mejor
  // sensación táctil).
  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  function handleMenuAction(fn) {
    setMenuOpen(false);
    fn?.();
  }

  // Si abren el menú sandwich teniendo el popover de la racha abierto,
  // cerramos este último para que no queden dos overlays activos.
  useEffect(() => {
    if (menuOpen && streakOpen) setStreakOpen(false);
  }, [menuOpen, streakOpen]);

  return (
    // Fragment: <header> usa backdrop-blur, lo que crea un containing block
    // para descendientes position:fixed. Si el modal de scoring vive dentro
    // del header, su backdrop fixed queda confinado a los 56px del header
    // en vez de cubrir la pantalla. Por eso ScoringHelpModal va FUERA.
    <>
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-[#08080a]/90 backdrop-blur-xl">
      <div className="relative mx-auto flex h-14 w-full max-w-md items-center justify-between px-3">
        <div className="relative z-10 flex min-w-0 items-center justify-start">
          {showStreak && (
            <>
              <StreakChip
                value={streak}
                buttonRef={chipRef}
                expanded={streakOpen}
                onClick={() => {
                  // Si abrimos el popover, cerramos el menú sandwich para
                  // evitar que ambos overlays se solapen.
                  setMenuOpen(false);
                  setStreakOpen((v) => !v);
                }}
              />
              <StreakPopover
                open={streakOpen}
                onClose={() => setStreakOpen(false)}
                anchorRef={chipRef}
                currentStreak={streak}
                onOpenScoring={() => {
                  setStreakOpen(false);
                  setScoringOpen(true);
                }}
              />
            </>
          )}
        </div>

        <div
          className="
            pointer-events-none absolute inset-0
            flex translate-y-[1px] items-center justify-center
            select-none whitespace-nowrap text-center font-display
            text-[1.75rem] tracking-widest text-white
            min-[360px]:text-[1.95rem] sm:text-[2.2rem]
          "
        >
          CARGUESSR
        </div>

        <div className="relative z-10 flex min-w-0 items-center justify-end">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={
              repescaAlert
                ? "Abrir menú · tienes una repesca disponible"
                : "Abrir menú"
            }
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            title="Menú"
            className={`relative ${iconBtn}`}
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
            {repescaAlert && !menuOpen && (
              <span
                aria-hidden="true"
                className="
                  pointer-events-none absolute -right-0.5 -top-0.5
                  h-3 w-3 rounded-full bg-amber-500
                  ring-2 ring-[#08080a]
                  animate-pulse
                "
              />
            )}
          </button>

          {menuOpen && (
            <div
              ref={menuRef}
              role="menu"
              className="
                absolute right-0 top-[calc(100%+0.5rem)]
                w-56 origin-top-right
                rounded-xl border border-white/10
                bg-[#0f0f12] p-1.5 shadow-2xl shadow-black/60
                backdrop-blur-xl
                animate-fade-in
              "
            >
              <MenuItem
                icon={<GarageIcon />}
                label="Mi garaje"
                alert={repescaAlert}
                onClick={() => handleMenuAction(onOpenGarage)}
              />
              <MenuItem
                icon={<TrophyIcon />}
                label="Ranking global"
                onClick={() => handleMenuAction(onOpenRanking)}
              />
              <div className="my-1 h-px bg-white/5" />
              {user ? (
                <MenuItem
                  icon={<UserIcon />}
                  label="Mi perfil"
                  onClick={() => handleMenuAction(onOpenProfile)}
                />
              ) : (
                <MenuItem
                  icon={<UserIcon />}
                  label="Iniciar sesión"
                  onClick={() => handleMenuAction(onOpenLogin)}
                />
              )}
            </div>
          )}
        </div>
      </div>

    </header>

    <ScoringHelpModal
      open={scoringOpen}
      onClose={() => setScoringOpen(false)}
    />
    </>
  );
}
