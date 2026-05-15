// src/App.jsx
import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import { supabase } from "./supabaseClient";
import { getMyProfile } from "./hooks/useStats";

import CarImage from "./components/CarImage";
import AttemptDots from "./components/AttemptDots";
import HintLegend from "./components/HintLegend";
import GuessRow from "./components/GuessRow";
import GuessForm from "./components/GuessForm";
import ResultPanel from "./components/ResultPanel";
import Header from "./components/Header";
import Ranking from "./components/Ranking";
import Garage from "./components/Garage";
import MyStats from "./components/MyStats";
import NicknameModal from "./components/NicknameModal";
import CloseButton from "./components/CloseButton";
import { useGame } from "./hooks/useGame";
import { useEscape } from "./hooks/useEscape";

function LockedRevealCard() {
  return (
    <div
      className="
        rounded-xl border border-accent/40 bg-bg-primary/85 p-4
        text-center shadow-xl shadow-black/50 backdrop-blur-md
        animate-fade-in
      "
    >
      <div className="mb-1 flex items-center justify-center gap-2 text-accent">
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="11" width="16" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        <span className="font-display text-xs uppercase tracking-[0.18em]">
          Coche bloqueado
        </span>
      </div>

      <p className="mt-2 text-[13px] leading-snug text-white/90">
        Inicia sesión para descubrir qué coche era,
        guardar tus estadísticas y entrar al ranking.
      </p>

      <button
        type="button"
        onClick={() => supabase.auth.signInWithOAuth({ provider: "google" })}
        className="
          mt-3 flex w-full items-center justify-center gap-2
          rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black
          transition-transform hover:scale-[1.02] active:scale-[0.98]
        "
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
        Continuar con Google
      </button>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [checkingProfile, setCheckingProfile] = useState(true);
  const [activeModal, setActiveModal] = useState(null);
  // Badge ámbar del icono del Garaje: true cuando hay repesca disponible
  // hoy y al menos un coche "missed" (ya fue coche del día y no se ganó).
  // Lo calculamos con una llamada ligera a /api/garage tras login.
  const [repescaAlert, setRepescaAlert] = useState(false);

  useEffect(() => {
    async function syncUser(session) {
      const nextUser = session?.user ?? null;
      setUser(nextUser);

      if (!nextUser) {
        setProfile(null);
        setCheckingProfile(false);
        setActiveModal(null);
        return;
      }

      setCheckingProfile(true);

      try {
        const nextProfile = await getMyProfile(nextUser.id);
        setProfile(nextProfile);
      } catch (error) {
        console.error("Error cargando perfil:", error);
        setProfile(null);
      } finally {
        setCheckingProfile(false);
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      syncUser(session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      syncUser(session);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Radar de repesca: tras login, miramos si hay repesca disponible Y
  // al menos un coche "missed" en el catálogo. Una sola petición ligera;
  // se refresca cuando cambia el `user.id` (login/logout) y cuando se
  // cierra el modal del Garaje (por si acaba de jugarse una repesca).
  useEffect(() => {
    if (!user) {
      setRepescaAlert(false);
      return;
    }
    let cancelled = false;
    async function checkAlert() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await fetch("/api/garage", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        // missed = ya fue coche del día Y el usuario no lo ha ganado.
        let missed = 0;
        for (const c of body.countries || []) {
          for (const car of c.cars || []) {
            if (!car.unlocked && car.wasDaily) missed++;
          }
        }
        setRepescaAlert(Boolean(body.repescaAvailable) && missed > 0);
      } catch (err) {
        // Fallar silenciosamente: el badge es decorativo, no crítico.
        console.error("[App] repesca alert check:", err);
      }
    }
    checkAlert();
    return () => {
      cancelled = true;
    };
    // Re-check cuando se cierra el modal del Garaje: el usuario puede haber
    // navegado a /repesca, jugado, y vuelto. activeModal === null tras eso.
  }, [user, activeModal]);

  function openRanking() {
    setActiveModal("ranking");
  }

  function openGarage() {
    setActiveModal("garage");
  }

  function openProfile() {
    setActiveModal("profile");
  }

  function openLogin() {
    setActiveModal("login");
  }

  function closeModal() {
    setActiveModal(null);
  }

  function handleSignedOut() {
    setUser(null);
    setProfile(null);
    setCheckingProfile(false);
    setActiveModal(null);
  }

  useEscape(activeModal === "login", closeModal);

  const {
    car,
    isLoading,
    isSubmitting,
    guesses,
    attempts,
    status,
    zoom,
    hintIndex,
    totalHints,
    score,
    maxAttempts,
    submitGuess,
    buildShareText,
  } = useGame();

  const today = new Date().toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  if (isLoading || !car) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary font-body text-white">
        <Analytics />
        <div className="flex flex-col items-center gap-4">
          <span className="animate-bounce text-4xl">🚗</span>
          <p className="animate-pulse text-sm uppercase tracking-widest text-muted">
            Aparcando coche...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-bg-primary font-body text-white">
      <Analytics />

      <Header
        user={user}
        onOpenRanking={openRanking}
        onOpenGarage={openGarage}
        onOpenProfile={openProfile}
        onOpenLogin={openLogin}
        repescaAlert={repescaAlert}
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
          <CarImage
            src={car.img}
            zoom={zoom}
            hintIndex={hintIndex}
            totalHints={totalHints}
            status={status}
            blurred={status === "lost" && !user}
            overlay={
              status === "lost" && !user ? (
                <LockedRevealCard />
              ) : null
            }
          />

          <AttemptDots attempts={attempts} max={maxAttempts} won={status === "won"} />

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
              isSubmitting={isSubmitting}
            />
          ) : (
            <ResultPanel
              status={status}
              car={car}
              attempts={attempts}
              maxAttempts={maxAttempts}
              shareText={buildShareText()}
              score={score}
              user={user}
              onOpenLogin={openLogin}
            />
          )}
        </main>
      </div>

      {activeModal === "login" && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl border border-border bg-bg-primary p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute right-2 top-2">
              <CloseButton onClick={closeModal} />
            </div>

            <h2 className="mb-4 font-display text-2xl tracking-widest text-accent">
              INICIAR SESIÓN
            </h2>
            <p className="mb-8 text-sm text-muted">
              Guarda tus estadísticas en la nube, compite en el ranking global y juega desde cualquier dispositivo.
            </p>

            <button
              onClick={() => supabase.auth.signInWithOAuth({ provider: "google" })}
              className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-3 font-semibold text-black transition-transform hover:scale-105 active:scale-95"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Continuar con Google
            </button>
          </div>
        </div>
      )}

      <Ranking
        open={activeModal === "ranking"}
        onClose={closeModal}
        user={user}
        onOpenLogin={openLogin}
      />

      <Garage
        open={activeModal === "garage"}
        onClose={closeModal}
        user={user}
        onOpenLogin={openLogin}
      />

      <MyStats
        open={activeModal === "profile"}
        onClose={closeModal}
        onSignedOut={handleSignedOut}
      />

      <NicknameModal
        open={Boolean(user && !checkingProfile && !profile?.display_name)}
        onSaved={(nextProfile) => {
          setProfile(nextProfile);
          setActiveModal(null);
        }}
      />
    </div>
  );
} 