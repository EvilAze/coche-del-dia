/// src/components/Header.jsx
// Props:
//   onOpenRanking  — fn(): abre el modal de ranking
//   onOpenProfile  — fn(): abre el modal de perfil
//   onOpenLogin    — fn(): abre el modal para iniciar sesión con Google
//   user           — objeto de usuario de Supabase (null si no hay sesión)

function LoginIcon() {
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
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
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

const iconBtn = `
  flex h-10 w-10 items-center justify-center rounded-full
  text-muted transition-colors duration-200
  hover:bg-accent/10 hover:text-accent
  active:scale-90
`;

export default function Header({ onOpenRanking, onOpenProfile, onOpenLogin, user }) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-[#08080a]/90 backdrop-blur-xl">
      <div className="mx-auto grid h-14 w-full max-w-md grid-cols-3 items-center px-3">
        <div className="flex min-w-0 justify-start">
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
              <LoginIcon />
            </button>
          )}
        </div>

        <div className="flex min-w-0 justify-center">
          <div className="select-none truncate text-center font-display text-2xl tracking-[0.2em] text-white">
            CARGUESSR
          </div>
        </div>

        <div className="flex min-w-0 justify-end">
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