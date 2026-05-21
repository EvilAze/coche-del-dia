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
import { useT } from "./i18n";
import { notifyAchievementsAfterWin } from "./hooks/useGame";

const MAX_ATTEMPTS = 5;
const MAX_ATTEMPTS_VETERAN = 1;
const ZOOM_LEVELS = [3.5, 3.0, 2.7, 2.4, 1.8];
// En Modo Veterano no hay zoom progresivo: arrancamos siempre en el
// nivel menos cerrado (el del último intento del modo normal).
const VETERAN_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

function triggerHaptic(pattern) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern);
  }
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
  const { t, locale } = useT();
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
  // Modo de la repesca: "normal" (5 intentos, pistas progresivas) o
  // "veteran" (1 intento, sin pistas). Lo dicta /api/repesca/start a
  // partir de si el usuario ya vio el coche al fallarlo. El servidor
  // es la fuente de verdad — manipular esto en cliente no salta el
  // límite de intentos (lo enforce /api/repesca/validate).
  const [mode, setMode] = useState("normal");
  // La imagen del coche se sirve vía /api/repesca/image, que requiere
  // Bearer token. Como los <img> nativos NO mandan headers custom, no
  // podemos usar la URL del endpoint directa. Hacemos fetch en JS con
  // Authorization, convertimos la respuesta a Blob, y le pasamos al <img>
  // una blob: URL local. Bonus: la URL es opaca (no filtra filename).
  const [imgBlobUrl, setImgBlobUrl] = useState(null);

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
      setError(t("repesca.errorNeedLogin"));
      return;
    }
    if (!carId) {
      setPhase("error");
      setError(t("repesca.errorMissingCarId"));
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Sin sesión");

        // /api/repesca/start es idempotente: si la repesca ya está
        // activa para este carId, no consume otra — solo devuelve el
        // estado actual. Además ahora nos manda el `state` con los
        // intentos previos, status y reveal (si aplica), así que no
        // necesitamos leer user_guesses por nuestra cuenta. Lo cual es
        // importante porque `carId` aquí es un PSEUDO opaco, no el
        // cars.id real — desde el cliente no podríamos hacer la query.
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
        if (cancelled) return;

        const state = startBody.state || { guesses: [], status: "playing", reveal: null };
        const existingGuesses = Array.isArray(state.guesses) ? state.guesses : [];
        const existingStatus = state.status || "playing";

        // Modo: lo dicta el server. Si por lo que sea no llega, fallback
        // a "normal" (más permisivo) para no bloquear al usuario.
        setMode(startBody.mode === "veteran" ? "veteran" : "normal");

        setGuesses(existingGuesses);
        if (existingStatus === "won" || existingStatus === "lost") {
          setPhase(existingStatus);
          if (state.reveal) setReveal(state.reveal);
        } else {
          setPhase("playing");
        }
      } catch (err) {
        if (cancelled) return;
        console.error("[Repesca] bootstrap:", err);
        setPhase("error");
        setError(err?.message || t("repesca.errorStartFailed"));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [checkingUser, user, carId]);

  // Carga la imagen del coche en repesca como blob: hacemos GET con
  // Authorization (cosa que <img> no puede), convertimos a Blob, y
  // generamos una blob: URL local que el navegador renderiza sin
  // necesidad de headers. Cleanup revoca la URL al desmontar / cambiar.
  // Solo arrancamos cuando estamos seguros de que la repesca está
  // activa (phase != "loading" && != "error").
  useEffect(() => {
    if (!user || !carId) return;
    if (phase === "loading" || phase === "error") return;

    let cancelled = false;
    let blobUrl = null;

    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) return;

        const res = await fetch(
          `/api/repesca/image?carId=${encodeURIComponent(carId)}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        blobUrl = URL.createObjectURL(blob);
        setImgBlobUrl(blobUrl);
      } catch (err) {
        console.error("[Repesca] image load:", err);
        // Dejamos imgBlobUrl en null: el skeleton de CarImage seguirá
        // visible. No es bloqueante — el usuario puede teclear su intento
        // aunque la foto no se vea (aunque sería loca).
      }
    })();

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [user, carId, phase]);

  const isVeteran = mode === "veteran";
  const effectiveMaxAttempts = isVeteran ? MAX_ATTEMPTS_VETERAN : MAX_ATTEMPTS;
  const attempts = guesses.length;
  const zoomIndex = Math.min(attempts, ZOOM_LEVELS.length - 1);
  // En Veterano no hay pistas progresivas: zoom fijo en el nivel menos
  // cerrado. En normal, sigue el patrón habitual.
  const zoom =
    phase === "playing"
      ? isVeteran
        ? VETERAN_ZOOM
        : ZOOM_LEVELS[zoomIndex]
      : 1.0;
  // En Veterano ocultamos la leyenda de pistas (no hay) pasando hintIndex
  // null aun en juego; HintLegend ya gestiona ese caso.
  const hintIndex = phase === "playing" && !isVeteran ? zoomIndex : null;
  const totalHints = ZOOM_LEVELS.length;

  // Estado tipo `car` que espera CarImage / ResultPanel. `img` arranca
  // como null y se rellena cuando la blob: URL está lista — CarImage ya
  // muestra su skeleton mientras tanto.
  const car = useMemo(
    () => ({
      img: imgBlobUrl,
      marca: reveal?.marca ?? null,
      modelo: reveal?.modelo ?? null,
      anio: reveal?.anio ?? null,
      pais: reveal?.pais ?? null,
      description: reveal?.description ?? null,
      description_en: reveal?.description_en ?? null,
    }),
    [imgBlobUrl, reveal]
  );

  async function submitGuess({ guessCarId, anio }) {
    if (phase !== "playing" || isSubmitting) return;
    if (typeof guessCarId !== "string" || !guessCarId) {
      toast.push(t("repesca.errorSelectCar"), { type: "error" });
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
      toast.push(t("repesca.errorNetworkConnection"), { type: "error" });
      setIsSubmitting(false);
      return;
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      console.error("[Repesca] non-JSON response", response.status);
      triggerHaptic([60, 40, 60]);
      toast.push(t("repesca.errorInvalidResponse"), { type: "error" });
      setIsSubmitting(false);
      return;
    }

    if (!response.ok) {
      console.error("[Repesca] server error", { status: response.status, data });
      triggerHaptic([60, 40, 60]);
      toast.push(
        data?.error ? `Error: ${data.error}` : t("repesca.errorValidationFailed"),
        { type: "error" }
      );
      setIsSubmitting(false);
      return;
    }

    try {
      const { result, reveal: nextReveal, score: scoreBreakdown } = data;
      if (!result) {
        toast.push(t("repesca.errorUnexpectedResponse"), { type: "error" });
        setIsSubmitting(false);
        return;
      }

      const newGuesses = [...guesses, result];
      let newPhase = "playing";
      if (result.win) newPhase = "won";
      else if (newGuesses.length >= effectiveMaxAttempts) newPhase = "lost";

      if (newPhase === "won") triggerHaptic(200);
      else if (newPhase === "lost") triggerHaptic([100, 50, 100]);

      setGuesses(newGuesses);
      setPhase(newPhase);
      if (nextReveal) setReveal(nextReveal);
      if (scoreBreakdown && newPhase !== "playing") setScore(scoreBreakdown);

      // Logros: solo aplican a usuarios logueados (la repesca ya lo
      // requiere). Tras ganar, detectamos desbloqueos nuevos y los
      // notificamos con toast staggered. Fire and forget.
      if (newPhase === "won" && user) {
        notifyAchievementsAfterWin({ toast, t, locale });
      }

      return result;
    } catch (err) {
      console.error("[Repesca] post-response error", err);
      triggerHaptic([60, 40, 60]);
      toast.push(t("repesca.errorProcessingResponse"), { type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  // ---- Renders ----

  // Mientras checkingUser, devolvemos un fondo limpio (sin loader): la
  // página llega aquí justo tras la animación de sorteo (zoom-blur de
  // cartas) y mostrar otra pantalla de carga rompía la continuidad.
  // El bootstrap real se cubre debajo con el skeleton de CarImage.
  if (checkingUser) {
    return <div className="min-h-screen bg-bg-primary" />;
  }

  if (phase === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4 font-body text-white">
        <div className="w-full max-w-sm rounded-2xl border border-red-400/40 bg-bg-secondary/60 p-6 text-center shadow-2xl">
          <p className="text-[10px] uppercase tracking-[0.28em] text-red-400">
            {t("repesca.errorUnavailable")}
          </p>
          <h1 className="mt-2 font-display text-2xl tracking-widest text-white">
            {t("repesca.errorMismatchTitle")}
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
            {t("repesca.buttonBackToGame")}
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
            <span>{t("repesca.buttonExit")}</span>
          </button>

          <p className="font-display text-xl tracking-widest text-white">
            {t("repesca.headerTitle")}
          </p>

          {/* Spacer para mantener "REPESCA" centrado visualmente */}
          <span className="w-[68px]" aria-hidden="true" />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-md min-w-0 flex-col px-3 pb-10 sm:px-4">
        <header className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3 border-b border-border py-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-accent">
              {isVeteran ? t("repesca.veteranBadge") : t("repesca.modeSubheader")}
            </p>
            <h1 className="mt-1 font-display text-[1.6rem] leading-none tracking-[0.12em] text-white">
              {t("repesca.pageTitle")}
            </h1>
            <p className="mt-1 truncate text-[10px] uppercase tracking-[0.22em] text-muted">
              {isVeteran
                ? t("repesca.veteranRulesNote")
                : t("repesca.gameRulesNote")}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <div className="font-display text-2xl leading-none text-accent">
              {/* Durante el bootstrap (phase === "loading") el modo aún no
                  llegó del servidor, así que evitar pintar "5" para que
                  luego salte a "1" en veteranos. Un guión es suficiente
                  como placeholder visual de 1-2 frames. */}
              {phase === "loading" ? "—" : effectiveMaxAttempts - attempts}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-muted">
              {t("repesca.attemptsLabel")}
            </div>
          </div>
        </header>

        {isVeteran && phase === "playing" && (
          <div
            className="
              mt-3 rounded-lg border border-amber-400/40 bg-amber-500/10
              px-3 py-2 text-[12px] leading-snug text-amber-100
            "
            role="note"
          >
            <span className="mr-1.5 font-display text-amber-300">🔥</span>
            {t("repesca.veteranExplain")}
          </div>
        )}

        <main className="w-full min-w-0">
          <CarImage
            src={car.img}
            zoom={zoom}
            hintIndex={hintIndex}
            totalHints={totalHints}
            status={phase}
          />

          <AttemptDots
            attempts={attempts}
            max={effectiveMaxAttempts}
            won={phase === "won"}
          />

          {!isVeteran && <HintLegend />}

          {guesses.length > 0 && (
            <div className="mb-4 mt-3 flex w-full min-w-0 flex-col gap-2">
              {guesses.map((g, i) => (
                <GuessRow key={i} guess={g} index={i} />
              ))}
            </div>
          )}

          {guesses.length > 0 && <div className="my-4 h-px bg-border" />}

          {phase === "loading" ? null : phase === "playing" ? (
            <GuessForm onSubmit={submitGuess} isSubmitting={isSubmitting} />
          ) : (
            <ResultPanel
              status={phase}
              car={car}
              attempts={attempts}
              maxAttempts={effectiveMaxAttempts}
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
