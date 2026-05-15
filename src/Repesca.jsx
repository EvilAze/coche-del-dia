// src/Repesca.jsx
// Página de juego dedicada al modo "Repesca diaria".
// Acceso: /repesca?id=<carId>  (enrutado desde src/index.js)
//
// El usuario llega aquí desde el Garaje tras confirmar la repesca: el
// endpoint /api/repesca/start ya ha consumido su intento del día y
// marcado en `stats` qué coche está repescando. Esta página:
//   1. Vuelve a llamar a /api/repesca/start (idempotente si el coche
//      es el mismo de la repesca activa) — sirve también si el usuario
//      pega la URL directamente.
//   2. Lee user_guesses para resumir la partida si ya había intentos.
//   3. Renderiza la misma UX que el juego diario (CarImage + GuessForm
//      + GuessRow + ResultPanel) pero hablando con /api/repesca/validate.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import CarImage from "./components/CarImage";
import AttemptDots from "./components/AttemptDots";
import HintLegend from "./components/HintLegend";
import GuessRow from "./components/GuessRow";
import GuessForm from "./components/GuessForm";
import ResultPanel from "./components/ResultPanel";
import { useToast } from "./components/Toast";

const MAX_ATTEMPTS = 5;
const ZOOM_LEVELS = [3.5, 3.0, 2.7, 2.4, 1.8];

function triggerHaptic(pattern) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern);
  }
}

function todayInMadrid() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getCarIdFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("id") || "";
  } catch {
    return "";
  }
}

export default function Repesca() {
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [checkingUser, setCheckingUser] = useState(true);

  const carId = useMemo(() => getCarIdFromUrl(), []);

  // Estado del juego.
  const [phase, setPhase] = useState("loading"); // loading | playing | won | lost | error
  const [error, setError] = useState("");
  const [guesses, setGuesses] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reveal, setReveal] = useState(null);
  const [score, setScore] = useState(null);

  // noindex + título de pestaña.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const prevTitle = document.title;
    document.title = "Repesca · Carguessr";
    return () => {
      document.head.removeChild(meta);
      document.title = prevTitle;
    };
  }, []);

  // Sesión.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setCheckingUser(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => {
      setUser(s?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Bootstrapping del juego: start (idempotente) + lectura de estado.
  useEffect(() => {
    if (checkingUser) return;
    if (!user) {
      setPhase("error");
      setError("Necesitas iniciar sesión para jugar la repesca.");
      return;
    }
    if (!carId) {
      setPhase("error");
      setError("Falta el identificador del coche.");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Sin sesión");

        // 1) Validar/consumir repesca (idempotente).
        const startRes = await fetch("/api/repesca/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ carId }),
        });
        const startBody = await startRes.json().catch(() => ({}));
        if (!startRes.ok) {
          throw new Error(startBody?.detail || startBody?.error || `HTTP ${startRes.status}`);
        }

        // 2) Estado actual en user_guesses para esta repesca.
        const today = todayInMadrid();
        const { data: stateRow, error: stateErr } = await supabase
          .from("user_guesses")
          .select("guesses, status, car_data")
          .eq("user_id", user.id)
          .eq("car_id", carId)
          .eq("date", today)
          .maybeSingle();
        if (cancelled) return;
        if (stateErr) {
          console.error("[Repesca] read user_guesses:", stateErr);
        }

        const existingGuesses = Array.isArray(stateRow?.guesses)
          ? stateRow.guesses
          : [];
        const existingStatus = stateRow?.status || "playing";
        setGuesses(existingGuesses);

        if (existingStatus === "won" || existingStatus === "lost") {
          setPhase(existingStatus);
          // Si la partida está terminada, car_data tiene el reveal.
          if (stateRow?.car_data) {
            setReveal({
              marca: stateRow.car_data.marca,
              modelo: stateRow.car_data.modelo,
              anio: stateRow.car_data.anio,
              pais: stateRow.car_data.pais,
              description: stateRow.car_data.description ?? null,
            });
          }
        } else {
          setPhase("playing");
        }
      } catch (err) {
        if (cancelled) return;
        console.error("[Repesca] bootstrap:", err);
        setPhase("error");
        setError(err?.message || "No se pudo iniciar la repesca.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [checkingUser, user, carId]);

  const attempts = guesses.length;
  const zoomIndex = Math.min(attempts, ZOOM_LEVELS.length - 1);
  const zoom = phase === "playing" ? ZOOM_LEVELS[zoomIndex] : 1.0;
  const hintIndex = phase === "playing" ? zoomIndex : null;
  const totalHints = ZOOM_LEVELS.length;

  // Estado tipo `car` que espera CarImage / ResultPanel.
  const car = useMemo(
    () => ({
      img: `/api/repesca/image?carId=${encodeURIComponent(carId)}`,
      marca: reveal?.marca ?? null,
      modelo: reveal?.modelo ?? null,
      anio: reveal?.anio ?? null,
      pais: reveal?.pais ?? null,
      description: reveal?.description ?? null,
    }),
    [carId, reveal]
  );

  async function submitGuess({ guessCarId, anio }) {
    if (phase !== "playing" || isSubmitting) return;
    if (typeof guessCarId !== "string" || !guessCarId) {
      toast.push("Selecciona un coche del listado.", { type: "error" });
      return;
    }

    setIsSubmitting(true);
    const payload = { carId, guessCarId, anio };

    let response;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers = { "Content-Type": "application/json" };
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      response = await fetch("/api/repesca/validate", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    } catch (networkErr) {
      console.error("[Repesca] fetch:", networkErr);
      triggerHaptic([60, 40, 60]);
      toast.push("Error de conexión. Comprueba tu red.", { type: "error" });
      setIsSubmitting(false);
      return;
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      console.error("[Repesca] non-JSON response", response.status);
      triggerHaptic([60, 40, 60]);
      toast.push("Respuesta inválida del servidor.", { type: "error" });
      setIsSubmitting(false);
      return;
    }

    if (!response.ok) {
      console.error("[Repesca] server error", { status: response.status, data });
      triggerHaptic([60, 40, 60]);
      toast.push(
        data?.error ? `Error: ${data.error}` : "No se pudo validar el intento.",
        { type: "error" }
      );
      setIsSubmitting(false);
      return;
    }

    try {
      const { result, reveal: nextReveal, score: scoreBreakdown } = data;
      if (!result) {
        toast.push("Respuesta inesperada del servidor.", { type: "error" });
        setIsSubmitting(false);
        return;
      }

      const newGuesses = [...guesses, result];
      let newPhase = "playing";
      if (result.win) newPhase = "won";
      else if (newGuesses.length >= MAX_ATTEMPTS) newPhase = "lost";

      if (newPhase === "won") triggerHaptic(200);
      else if (newPhase === "lost") triggerHaptic([100, 50, 100]);

      setGuesses(newGuesses);
      setPhase(newPhase);
      if (nextReveal) setReveal(nextReveal);
      if (scoreBreakdown && newPhase !== "playing") setScore(scoreBreakdown);

      return result;
    } catch (err) {
      console.error("[Repesca] post-response error", err);
      triggerHaptic([60, 40, 60]);
      toast.push("Error procesando la respuesta.", { type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  // ---- Renders ----

  if (checkingUser || phase === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary font-body text-white">
        <div className="flex flex-col items-center gap-4">
          <span className="animate-bounce text-4xl">🎯</span>
          <p className="animate-pulse text-sm uppercase tracking-widest text-muted">
            Cargando repesca...
          </p>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4 font-body text-white">
        <div className="w-full max-w-sm rounded-2xl border border-red-400/40 bg-bg-secondary/60 p-6 text-center shadow-2xl">
          <p className="text-[10px] uppercase tracking-[0.28em] text-red-400">
            Repesca no disponible
          </p>
          <h1 className="mt-2 font-display text-2xl tracking-widest text-white">
            Algo no encaja
          </h1>
          <p className="mt-3 text-sm text-muted">{error}</p>
          <button
            type="button"
            onClick={() => {
              window.location.href = "/";
            }}
            className="
              mt-5 h-11 w-full rounded-xl bg-accent
              font-display tracking-widest text-bg-primary
              transition hover:brightness-110 active:scale-[0.98]
            "
          >
            Volver al juego
          </button>
        </div>
      </div>
    );
  }

  const shareText = ""; // No compartimos resultados de repesca (es individual).

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-bg-primary font-body text-white">
      {/* Header simple, sin sticky para no robar espacio vertical */}
      <header className="border-b border-white/10 bg-[#08080a]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-md items-center justify-between px-3">
          <button
            type="button"
            onClick={() => {
              window.location.href = "/";
            }}
            className="
              inline-flex items-center gap-1.5 rounded-md
              border border-white/10 bg-white/[0.04]
              px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-white/80
              transition hover:border-accent/60 hover:bg-accent/10 hover:text-accent
              active:scale-95
            "
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span>Salir</span>
          </button>

          <p className="font-display text-xl tracking-widest text-white">
            REPESCA
          </p>

          {/* Spacer para mantener "REPESCA" centrado visualmente */}
          <span className="w-[68px]" aria-hidden="true" />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-md min-w-0 flex-col px-3 pb-10 sm:px-4">
        <header className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3 border-b border-border py-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-accent">
              Modo Repesca · una al día
            </p>
            <h1 className="mt-1 font-display text-[1.6rem] leading-none tracking-[0.12em] text-white">
              Recuperar coche
            </h1>
            <p className="mt-1 truncate text-[10px] uppercase tracking-[0.22em] text-muted">
              Puntos a la mitad · no afecta a tu racha
            </p>
          </div>

          <div className="shrink-0 text-right">
            <div className="font-display text-2xl leading-none text-accent">
              {MAX_ATTEMPTS - attempts}
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
            status={phase}
          />

          <AttemptDots attempts={attempts} max={MAX_ATTEMPTS} won={phase === "won"} />

          <HintLegend />

          {guesses.length > 0 && (
            <div className="mb-4 mt-3 flex w-full min-w-0 flex-col gap-2">
              {guesses.map((g, i) => (
                <GuessRow key={i} guess={g} index={i} />
              ))}
            </div>
          )}

          {guesses.length > 0 && <div className="my-4 h-px bg-border" />}

          {phase === "playing" ? (
            <GuessForm onSubmit={submitGuess} isSubmitting={isSubmitting} />
          ) : (
            <ResultPanel
              status={phase}
              car={car}
              attempts={attempts}
              maxAttempts={MAX_ATTEMPTS}
              shareText={shareText}
              score={score}
              user={user}
            />
          )}
        </main>
      </div>
    </div>
  );
}
