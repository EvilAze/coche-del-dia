import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M8 4h8v3a4 4 0 0 1-8 0V4Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M8 6H5a3 3 0 0 0 3 3M16 6h3a3 3 0 0 1-3 3M12 11v5M9 20h6M10 16h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M5 19V5M5 19h14M9 15v-4M13 15V8M17 15v-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function Header() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const menuRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  async function loginConGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });
  }

  async function cerrarSesion() {
    await supabase.auth.signOut();
    setOpen(false);
  }

  const user = session?.user;

  const nombre =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email;

  const avatar =
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.picture;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-[#08080a]/90 backdrop-blur-xl">
      <div className="mx-auto grid h-14 w-full max-w-md grid-cols-[44px_1fr_44px] items-center px-3">
        <div />

        <div className="text-center font-display text-2xl font-bold tracking-[0.2em] text-white">
          CARGUESSR
        </div>

        <div ref={menuRef} className="relative flex justify-end">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="
              flex h-10 w-10 items-center justify-center rounded-full
              border border-white/10 bg-white/[0.04] text-white
              transition hover:border-accent/60 hover:bg-accent/10
              active:scale-95
            "
            aria-label="Abrir menú"
            aria-expanded={open}
          >
            <MenuIcon />
          </button>

          {open && (
            <div
              className="
                absolute right-0 top-12 w-[min(19rem,calc(100vw-1.5rem))]
                overflow-hidden rounded-2xl border border-white/10
                bg-[#111113]/95 shadow-2xl shadow-black/40 backdrop-blur-xl
                animate-fade-in
              "
            >
              <div className="border-b border-white/10 p-3">
                {loading ? (
                  <p className="text-sm text-muted">Cargando...</p>
                ) : user ? (
                  <div className="flex items-center gap-3">
                    {avatar && (
                      <img
                        src={avatar}
                        alt={nombre}
                        className="h-10 w-10 shrink-0 rounded-full border border-white/10 object-cover"
                      />
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">
                        {nombre}
                      </p>
                      <p className="text-xs text-muted">Sesión iniciada</p>
                    </div>

                    <button
                      type="button"
                      onClick={cerrarSesion}
                      className="
                        shrink-0 rounded-lg border border-white/10 px-3 py-2
                        text-[10px] uppercase tracking-widest text-muted
                        transition hover:border-red-400/70 hover:text-red-300
                      "
                    >
                      Salir
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={loginConGoogle}
                    className="
                      flex w-full items-center justify-center gap-2 rounded-xl
                      bg-white px-4 py-3 text-sm font-semibold text-black
                      transition hover:bg-zinc-100 active:scale-[0.98]
                    "
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-zinc-300 text-sm font-bold text-blue-600">
                      G
                    </span>
                    Iniciar sesión con Google
                  </button>
                )}
              </div>

              <nav className="p-2">
                <button
                  type="button"
                  className="
                    flex w-full items-center gap-3 rounded-xl px-3 py-3
                    text-left text-sm text-white transition
                    hover:bg-white/[0.06]
                  "
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <TrophyIcon />
                  </span>
                  Ranking Global
                </button>

                <button
                  type="button"
                  className="
                    flex w-full items-center gap-3 rounded-xl px-3 py-3
                    text-left text-sm text-white transition
                    hover:bg-white/[0.06]
                  "
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <ChartIcon />
                  </span>
                  Mis Estadísticas
                </button>
              </nav>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
