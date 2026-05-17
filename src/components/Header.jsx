/// src/components/Header.jsx
// Props:
//   onOpenRanking  — fn(): abre el modal de ranking
//   onOpenGarage   — fn(): abre el modal del garaje (álbum)
//   onOpenProfile  — fn(): abre el modal de perfil
//   onOpenLogin    — fn(): abre el modal para iniciar sesión con Google
//   user           — objeto de usuario de Supabase (null si no hay sesión)
//   streak         — entero, racha actual. Si > 0 y user, se pinta un badge
//                    dorado 🔥 N dentro del botón del usuario. Si 0 o null,
//                    el botón muestra solo el icono.
//   repescaAlert   — boolean, si true pinta el punto ámbar pulsante sobre
//                    el icono del Garaje.

import { useEffect, useRef, useState } from "react";

function UserIcon() {
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
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

function TrophyIcon() {
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
      <path d="M6 4h12v5a6 6 0 0 1-12 0V4Z" />
      <path d="M6 6H3a3 3 0 0 0 3 5" />
      <path d="M18 6h3a3 3 0 0 1-3 5" />
      <path d="M12 15v4" />
      <path d="M8 19h8" />
    </svg>
  );
}

function GarageIcon() {
  // Silueta tipo "garage door" con un coche dentro. Stroke fino para
  // armonizar con UserIcon y TrophyIcon.
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
      {/* Tejado del garaje */}
      <path d="M3 10 12 4l9 6" />
      {/* Pilares laterales */}
      <path d="M4 10v10" />
      <path d="M20 10v10" />
      {/* Puerta del garaje (silueta de coche interior) */}
      <path d="M7 20v-6h10v6" />
      <path d="M9 17h6" />
    </svg>
  );
}

const iconBtn = `
  flex h-11 w-11 items-center justify-center rounded-full
  text-muted transition-colors duration-200
  hover:bg-accent/10 hover:text-accent
  active:scale-90
`;

// Variante del botón cuando incluye el badge de racha. h-11 fija, width
// dinámico (h-11 rounded-full pl-2 pr-3 con gap interno). Cambia el fondo
// para destacar discretamente al jugador con racha activa.
const userBtnWithStreak = `
  flex h-11 items-center gap-1.5 rounded-full
  pl-2 pr-3 text-muted transition-colors duration-200
  hover:bg-accent/10 hover:text-accent
  active:scale-90
`;

// StreakBadge: contenido del chip dentro del botón. Anima un "pop" cuando
// el número aumenta (racha subió) para reforzar feedback positivo. El ref
// guarda el valor previo para detectar el cambio sin renders extra.
function StreakBadge({ value }) {
  const prevRef = useRef(value);
  const [pop, setPop] = useState(false);

  useEffect(() => {
    // Snapshot del valor anterior y actualizamos prev SIEMPRE — si no, una
    // subida de 5 → 6 dejaría prev congelado en 5 y la siguiente subida
    // (6 → 7) volvería a comparar contra 5 y dispararía el pop dos veces.
    const prev = prevRef.current;
    prevRef.current = value;

    if (value > prev) {
      setPop(true);
      // Reset tras animación. 300 ms = duración de la keyframe `pop`;
      // dejamos 400 para que la clase se quite con margen.
      const t = setTimeout(() => setPop(false), 400);
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <span
      className={`
        flex items-center gap-0.5 text-sm font-bold text-accent
        ${pop ? "animate-pop" : ""}
      `}
      // El emoji 🔥 es ligeramente más alto que las cifras. Le doy un baseline
      // ajuste fino para que se vea alineado verticalmente con el número.
      style={{ lineHeight: 1 }}
    >
      <span aria-hidden="true" className="text-[0.95rem]">🔥</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

export default function Header({
  onOpenRanking,
  onOpenGarage,
  onOpenProfile,
  onOpenLogin,
  user,
  repescaAlert = false,
  streak = 0,
}) {
  const showStreak = Boolean(user) && streak > 0;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-[#08080a]/90 backdrop-blur-xl">
      <div className="relative mx-auto flex h-14 w-full max-w-md items-center justify-between px-3">
        <div className="z-10 flex min-w-0 items-center justify-start">
          {user ? (
            <button
              type="button"
              onClick={onOpenProfile}
              aria-label={
                showStreak
                  ? `Mi perfil · racha de ${streak} días`
                  : "Mi perfil"
              }
              title={showStreak ? `Racha: ${streak}` : "Mi perfil"}
              className={showStreak ? userBtnWithStreak : iconBtn}
            >
              <UserIcon />
              {showStreak && <StreakBadge value={streak} />}
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenLogin}
              aria-label="Iniciar sesión"
              title="Iniciar sesión"
              className={iconBtn}
            >
              <UserIcon />
            </button>
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

        <div className="z-10 flex min-w-0 items-center justify-end gap-0.5">
          <button
            type="button"
            onClick={onOpenGarage}
            aria-label={
              repescaAlert
                ? "Mi garaje · tienes una repesca disponible"
                : "Mi garaje"
            }
            title="Mi garaje"
            className={`relative ${iconBtn}`}
          >
            <GarageIcon />
            {repescaAlert && (
              // Puntito ámbar pulsante. `ring-2 ring-[#08080a]` lo separa
              // visualmente del icono cuando el botón está sobre el header
              // semi-transparente. `pointer-events-none` para que el click
              // pase al botón aunque caiga sobre el dot.
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
          <button
            type="button"
            onClick={onOpenRanking}
            aria-label="Ranking global"
            title="Ranking global"
            className={iconBtn}
          >
            <TrophyIcon />
          </button>
        </div>
      </div>
    </header>
  );
}
