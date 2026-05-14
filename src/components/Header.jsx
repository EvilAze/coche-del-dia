/// src/components/Header.jsx
// Props:
//   onOpenRanking  — fn(): abre el modal de ranking
//   onOpenGarage   — fn(): abre el modal del garaje (álbum)
//   onOpenProfile  — fn(): abre el modal de perfil
//   onOpenLogin    — fn(): abre el modal para iniciar sesión con Google
//   user           — objeto de usuario de Supabase (null si no hay sesión)

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

export default function Header({
  onOpenRanking,
  onOpenGarage,
  onOpenProfile,
  onOpenLogin,
  user,
}) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-[#08080a]/90 backdrop-blur-xl">
      <div className="relative mx-auto flex h-14 w-full max-w-md items-center justify-between px-3">
        <div className="z-10 flex min-w-0 items-center justify-start">
          {user ? (
            <button
              type="button"
              onClick={onOpenProfile}
              aria-label="Mi perfil"
              title="Mi perfil"
              className={iconBtn}
            >
              <UserIcon />
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
            aria-label="Mi garaje"
            title="Mi garaje"
            className={iconBtn}
          >
            <GarageIcon />
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
