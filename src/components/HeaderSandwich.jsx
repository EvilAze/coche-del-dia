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
function StreakChip({ value, onClick }) {
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
      type="button"
      onClick={onClick}
      aria-label={`Racha de ${value} días. Sigue así.`}
      title={`Llevas ${value} día${value === 1 ? "" : "s"} de racha · sigue así`}
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
  const menuRef = useRef(null);
  const triggerRef = useRef(null);

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

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-[#08080a]/90 backdrop-blur-xl">
      <div className="relative mx-auto flex h-14 w-full max-w-md items-center justify-between px-3">
        <div className="z-10 flex min-w-0 items-center justify-start">
          {showStreak && (
            <StreakChip value={streak} onClick={onOpenProfile} />
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
  );
}
