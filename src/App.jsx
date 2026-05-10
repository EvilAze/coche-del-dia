// src/App.jsx
import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import { Analytics } from "@vercel/analytics/react";

import CarImage    from "./components/CarImage";
import AttemptDots from "./components/AttemptDots";
import HintLegend  from "./components/HintLegend";
import GuessRow    from "./components/GuessRow";
import GuessForm   from "./components/GuessForm";
import ResultPanel from "./components/ResultPanel";
import Header      from "./components/Header";
import Ranking     from "./components/Ranking";
import MyStats     from "./components/MyStats";
import { useGame } from "./hooks/useGame";

export default function App() {
  // ── Usuario (para pasarlo al Header) ──────────────────────────────────────
  const [user, setUser] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // ── Modales ────────────────────────────────────────────────────────────────
  const [activeModal, setActiveModal] = useState(null); // null | "ranking" | "profile" | "login"

  function openRanking() { setActiveModal("ranking"); }
  function openProfile() { setActiveModal("profile");  }
  function openLogin()   { setActiveModal("login");    } 
  function closeModal()  { setActiveModal(null);       }
  function handleSignedOut() {
  setUser(null);
  setActiveModal(null);
}


  // ── Juego ──────────────────────────────────────────────────────────────────
  const {
    car,
    isLoading,
    isSubmitting,
    guesses,
    attempts,
    status,
    zoom,
    zoomLabel,
    maxAttempts,
    submitGuess,
    buildShareText,
  } = useGame();

  const today = new Date().toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // ── Carga ──────────────────────────────────────────────────────────────────
  if (isLoading || !car) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary font-body text-white">
        <div className="flex flex-col items-center gap-4">
          <span className="animate-bounce text-4xl">🚗</span>
          <p className="animate-pulse text-sm uppercase tracking-widest text-muted">
            Aparcando coche...
          </p>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-bg-primary font-body text-white">
      <Analytics />

      {/* Header recibe user y la función onOpenLogin conectada */}
      <Header
        user={user}
        onOpenRanking={openRanking}
        onOpenProfile={openProfile}
        onOpenLogin={openLogin}
      />

      <div className="mx-auto flex w-full max-w-md min-w-0 flex-col px-3 pb-10 sm:px-4">

        <header className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3 border-b border-border py-4">
          <div className="min-w-0">
            <h1 className="font-display text-[1.8rem] leading-none tracking-[0.12em] text-accent min-[380px]:text-4xl min-[380px]:tracking-widest">
              Coche del Día
            </h1>
            <p className="mt-1 truncate text-[10px] uppercase tracking-[0.22em] text-muted">
              {today}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <div className="font-display text-2xl leading-none text-accent">
              {maxAttempts - attempts}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-muted">
              intentos
            </div>
          </div>
        </header>

        <main className="w-full min-w-0">
          <CarImage src={car.img} zoom={zoom} zoomLabel={zoomLabel} />

          <AttemptDots attempts={attempts} max={maxAttempts} />

          <HintLegend />

          {guesses.length > 0 && (
            <div className="mb-4 mt-3 flex w-full min-w-0 flex-col gap-2">
              {guesses.map((g, i) => (
                <GuessRow key={i} guess={g} index={i} />
              ))}
            </div>
          )}

          {guesses.length > 0 && <div className="my-4 h-px bg-border" />}

          {status === "playing" ? (
            <GuessForm
              onSubmit={submitGuess}
              disabled={status !== "playing" || isSubmitting}
            />
          ) : (
            <ResultPanel
              status={status}
              car={car}
              attempts={attempts}
              maxAttempts={maxAttempts}
              shareText={buildShareText()}
            />
          )}
        </main>
      </div>

      {/* ── VENTANA DE INICIO DE SESIÓN ── */}
      {activeModal === "login" && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-2xl border border-border bg-bg-primary p-6 text-center shadow-2xl">
            {/* Botón de cerrar */}
            <button 
              onClick={closeModal}
              className="absolute right-4 top-4 text-muted hover:text-white"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            <h2 className="mb-4 font-display text-2xl tracking-widest text-accent">INICIAR SESIÓN</h2>
            <p className="mb-8 text-sm text-muted">
              Guarda tus estadísticas en la nube, compite en el ranking global y juega desde cualquier dispositivo.
            </p>
            
            {/* Botón de Google conectado a Supabase */}
            <button
              onClick={() => supabase.auth.signInWithOAuth({ provider: 'google' })}
              className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-3 font-semibold text-black transition-transform hover:scale-105 active:scale-95"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continuar con Google
            </button>
          </div>
        </div>
      )}

      {/* Modales Existentes */}
      <Ranking open={activeModal === "ranking"} onClose={closeModal} />
      <MyStats
  open={activeModal === "profile"}
  onClose={closeModal}
  onSignedOut={handleSignedOut}
/>

    </div>
  );
}