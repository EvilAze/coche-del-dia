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
//   2. Lee el estado de la partida del propio start (intentos, status, reveal).
//   3. Renderiza la MISMA UX que el juego diario, hablando con
//      /api/repesca/validate.
//
// Identidad visual: lenguaje «Prensa del motor», el mismo que el juego diario
// (Configurator.jsx). Antes esta página montaba el stack legacy (CarImage
// suelto + ShiftLights + GuessLog + ResultPanel) y se sentía "de otra app"
// respecto al juego principal. Ahora comparte el shell .cdd-app.prensa y las
// piezas editoriales: ZoomStage (foto con ladillo/pie), AttemptProgress (pips
// de negativo), AttemptRow/AttemptList (clasificación de corrector) y un
// revelado cinematográfico tipo EndScreen (clases cdd-end), con el desglose de
// puntos propio de la repesca en el cuerpo. El formulario (GuessForm del
// configurator) ya estaba unificado; el resto se alinea aquí.

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
// Piezas del lenguaje «Prensa del motor», compartidas con el juego diario
// (Configurator). La foto la sigue pintando CarImage en modo `configurator`
// DENTRO de ZoomStage (pipeline/seguridad de imagen intactos).
import ZoomStage from "./components/configurator/ZoomStage";
import AttemptProgress from "./components/configurator/AttemptProgress";
import AttemptList, { AttemptRow } from "./components/configurator/AttemptList";
// Formulario unificado con el del juego diario (Combo + YearField, piel v0).
// Misma lógica anti-cheat y mismo contrato onSubmit({ guessCarId, anio, ... });
// submitGuess de aquí solo consume { guessCarId, anio }.
import GuessForm from "./components/configurator/GuessForm";
// Desglose de puntos: pieza PROPIA de la repesca (el daily no lo muestra; su
// EndScreen habla de racha/percentil). En la repesca los puntos van a la mitad
// y no afectan a la racha, así que este bloque es la recompensa visible.
import ScoreBreakdown from "./components/ScoreBreakdown";
import AchievementIcon from "./components/AchievementIcons";
import { useToast } from "./components/Toast";
import { useT, getCarDescription, getLocalizedCountry } from "./i18n";
import { flagImagePath } from "./data/countries";
import { shareGrid } from "./lib/shareText";
import { notifyAchievementsAfterWin } from "./lib/achievementsNotifier";
import { track } from "./lib/analytics";
import { haptic } from "./lib/haptics";
import { cssZoomLevels, ZOOM_ATTEMPTS, DEFAULT_ZOOM_BASE } from "./lib/zoom.js";

const MAX_ATTEMPTS = 5;
const MAX_ATTEMPTS_VETERAN = 1;
// Margen de tolerancia del año (±2). Réplica cliente del ANIO_CORRECT_MARGIN
// del servidor (api/repesca/validate.js y api/_lib/compare-guess.js, ambos = 2):
// solo alimenta el texto "±2 años" del campo de año, NO la validación (esa la
// hace el server). Igual valor que el juego diario, así la UX es coherente.
const ANIO_CORRECT_MARGIN = 2;
// Dirección visual: misma que el juego diario (Configurator.jsx, «Prensa del
// motor», rojo de rotativa). La repesca hereda las variables de .prensa vía las clases
// .cdd-*/.prensa-* que usa; --accent apunta al rojo (focus-ring y piezas cdd).
const ACCENT = "#b3271b";
// El zoom escalonado es el MISMO sistema que el juego diario y POR COCHE: los
// scales CSS se derivan del zoom_base del coche (cssZoomLevels, src/lib/zoom.js)
// y se aplican sobre el crop del último intento que sirve api/repesca/image.js.

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
  // Bearer token. Como los elementos img nativos NO mandan headers custom, no
  // podemos usar la URL del endpoint directa. Hacemos fetch en JS con
  // Authorization, convertimos la respuesta a Blob, y le pasamos al elemento img
  // una blob: URL local. Bonus: la URL es opaca (no filtra filename).
  const [imgBlobUrl, setImgBlobUrl] = useState(null);
  // LQIP (blur_data) que devuelve /api/repesca/start. CarImage lo pinta
  // como fondo borroso mientras llega la foto real → mismo efecto
  // "blur-up" que el juego principal. Identidad visual compartida.
  const [blurData, setBlurData] = useState(null);
  // Zoom inicial del coche (lo da /api/repesca/start). De él se derivan los
  // scales CSS por intento, igual que en el juego diario. Default 3.7.
  const [zoomBase, setZoomBase] = useState(DEFAULT_ZOOM_BASE);

  // Revelado final como overlay (mismo patrón que el Configurator): se
  // auto-abre SOLO en la transición playing → ended de ESTA sesión, con el
  // mismo delay para que el revelado de la foto respire antes del modal. Si el
  // usuario recarga con la partida ya cerrada, NO se auto-abre: mostramos el
  // botón "VER RESULTADO" (como el daily), no saltamos el overlay de golpe.
  const [showEnd, setShowEnd] = useState(false);
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    const isEnded = phase === "won" || phase === "lost";
    if (prevPhaseRef.current === "playing" && isEnded) {
      const id = setTimeout(() => setShowEnd(true), 900);
      prevPhaseRef.current = phase;
      return () => clearTimeout(id);
    }
    prevPhaseRef.current = phase;
  }, [phase]);

  // noindex + título de pestaña.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const prevTitle = document.title;
    document.title = "Repesca · El Coche del Día";
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

        // LQIP para el blur-up (puede venir null si la lectura falló server-side).
        if (startBody.blurData) setBlurData(startBody.blurData);
        if (Number.isFinite(startBody.zoomBase)) setZoomBase(startBody.zoomBase);

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
  // Authorization (cosa que una etiqueta img no puede), convertimos a Blob, y
  // generamos una blob: URL local que el navegador renderiza sin
  // necesidad de headers. Cleanup revoca la URL al desmontar / cambiar.
  // Solo arrancamos cuando estamos seguros de que la repesca está
  // activa (phase != "loading" && != "error").
  useEffect(() => {
    if (!user || !carId) return;
    if (phase === "loading" || phase === "error") return;

    let cancelled = false;
    let blobUrl = null;

    // `phase` en la URL diferencia la cache key entre la imagen recortada
    // (durante el juego) y la revelada completa (al terminar). El server
    // ignora este param para decidir crop/full — eso lo dicta user_guesses,
    // no el cliente —, pero al cambiar la query, la imagen cropped y la full
    // no se pisan en la cache privada del navegador. Además, `phase=playing`
    // coincide con la URL que precarga Garage.jsx durante el barajeo → la
    // primera carga de /repesca es un cache hit instantáneo.
    const phaseParam =
      phase === "won" || phase === "lost" ? "done" : "playing";

    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) return;

        const res = await fetch(
          `/api/repesca/image?carId=${encodeURIComponent(carId)}&phase=${phaseParam}`,
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
  const ended = phase === "won" || phase === "lost";
  const won = phase === "won";
  const zoomIndex = Math.min(attempts, ZOOM_ATTEMPTS - 1);
  // Scales CSS por intento derivados del zoom_base del coche (mismo sistema que
  // el juego diario). El último vale 1.0 (ya se ve todo el crop servido).
  const zoomLevels = cssZoomLevels(zoomBase);
  // En Veterano no hay pistas progresivas: zoom fijo en el nivel menos cerrado
  // (el del último intento = scale 1.0). En normal, sigue el patrón habitual.
  const zoom =
    phase === "playing"
      ? isVeteran
        ? zoomLevels[zoomLevels.length - 1]
        : zoomLevels[zoomIndex]
      : 1.0;
  // En Veterano no hay pistas progresivas: hintIndex null → ZoomStage no pinta
  // el contador "PISTA n de m" (coherente con el badge "1 intento, sin pistas").
  const hintIndex = phase === "playing" && !isVeteran ? zoomIndex : null;
  const totalHints = ZOOM_ATTEMPTS;

  // Estado tipo `car` que espera ZoomStage/CarImage. `img` arranca como null y
  // se rellena cuando la blob: URL está lista — CarImage ya muestra su skeleton
  // mientras tanto.
  const car = useMemo(
    () => ({
      img: imgBlobUrl,
      blurData,
      marca: reveal?.marca ?? null,
      modelo: reveal?.modelo ?? null,
      anio: reveal?.anio ?? null,
      pais: reveal?.pais ?? null,
      description: reveal?.description ?? null,
      description_en: reveal?.description_en ?? null,
    }),
    [imgBlobUrl, blurData, reveal]
  );
  // Solo hay identidad que mostrar si el server la reveló (victoria; o derrota
  // de usuario logueado). Si no, el revelado enseña solo el veredicto.
  const hasReveal = Boolean(car.marca && car.modelo && car.anio);
  const description = getCarDescription(car)?.trim();

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
      haptic.error();
      toast.push(t("repesca.errorNetworkConnection"), { type: "error" });
      setIsSubmitting(false);
      return;
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      console.error("[Repesca] non-JSON response", response.status);
      haptic.error();
      toast.push(t("repesca.errorInvalidResponse"), { type: "error" });
      setIsSubmitting(false);
      return;
    }

    if (!response.ok) {
      console.error("[Repesca] server error", { status: response.status, data });
      haptic.error();
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

      if (newPhase === "won") haptic.success();
      else if (newPhase === "lost") haptic.warning();

      setGuesses(newGuesses);
      setPhase(newPhase);
      if (nextReveal) setReveal(nextReveal);
      if (scoreBreakdown && newPhase !== "playing") setScore(scoreBreakdown);

      // Analytics: resultado de la repesca con su modo (normal/veteran).
      if (newPhase === "won") {
        track("repesca_win", { mode, attempts: newGuesses.length });
      } else if (newPhase === "lost") {
        track("repesca_lose", { mode });
      }

      // Logros: solo aplican a usuarios logueados (la repesca ya lo
      // requiere). Tras ganar, detectamos desbloqueos nuevos y los
      // notificamos con toast staggered. Fire and forget.
      if (newPhase === "won" && user) {
        notifyAchievementsAfterWin({ toast, t, locale });
      }

      return result;
    } catch (err) {
      console.error("[Repesca] post-response error", err);
      haptic.error();
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
    // Tarjeta de error centrada (tono rojo): papel + filete rojo + CTA de
    // tinta. Fuera del shell .prensa porque no usa piezas .cdd-*/.prensa-*;
    // las fuentes (Fraunces/Franklin) ya son globales.
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4 font-body text-tinta">
        <div className="w-full max-w-sm rounded-2xl border border-rojo/40 bg-papel-2 p-6 text-center shadow-2xl">
          <p className="text-[10px] uppercase tracking-[0.28em] text-red-400">
            {t("repesca.errorUnavailable")}
          </p>
          <h1 className="mt-2 font-display text-2xl tracking-widest text-tinta">
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

  return (
    // Mismo shell visual que el juego diario (Configurator): tema
    // .prensa con el acento rojo inyectado en --accent — de él beben las cdd-*.
    <div className="cdd-app prensa" style={{ "--accent": ACCENT }}>
      {/* Header simple: salir (a la izquierda) +
          título centrado. A la derecha, spacer para mantener REPESCA centrado
          (la repesca no lleva marcador). */}
      <header className="border-b border-border bg-bg-primary">
        <div className="mx-auto flex h-14 w-full max-w-md items-center justify-between px-3">
          <button
            type="button"
            onClick={() => {
              window.location.href = "/?garage=true";
            }}
            className="
              inline-flex items-center gap-1.5 rounded-md
              border border-tinta/15 bg-papel-2/60
              px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-tinta-2
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

          <p className="font-display text-xl tracking-widest text-tinta">
            {t("repesca.headerTitle")}
          </p>

          {/* Spacer para mantener "REPESCA" centrado visualmente */}
          <span className="w-[68px]" aria-hidden="true" />
        </div>
      </header>

      {/* Columna única centrada, calcada del Configurator (max-w-md, gap). */}
      <main className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-5 px-4 pb-10 pt-4 safe-area-pad">
        {/* Contexto del modo: kicker centrado sobre la imagen. */}
        <div>
          <p className="text-center text-[10px] uppercase tracking-[0.28em] text-accent">
            {isVeteran ? t("repesca.veteranBadge") : t("repesca.modeSubheader")}
          </p>
          {!isVeteran && (
            <p className="mt-1 text-center text-xs text-muted/80">
              {t("repesca.gameRulesNote")}
            </p>
          )}
        </div>

        {/* Nota veterano: reglas más duras (1 intento, sin pistas). */}
        {isVeteran && phase === "playing" && (
          <div
            className="
              flex items-start gap-2 rounded-lg border border-amber-400/40
              bg-amber-500/10 px-3 py-2 text-[12px] leading-snug text-amber-100
            "
            role="note"
          >
            <AchievementIcon name="spark" size="h-4 w-4" color="text-amber-300" />
            <span>{t("repesca.veteranExplain")}</span>
          </div>
        )}

        {/* Escenario con ladillo/pie editorial, como el daily. Envuelto en un
            div para neutralizar el order:2 de .prensa-area-foto en esta columna
            flex (el order solo aplica entre hermanos flex, y aquí el <section>
            es hijo único del div). */}
        <div>
          <ZoomStage
            car={car}
            zoom={zoom}
            status={ended ? phase : "playing"}
            hintIndex={hintIndex}
            totalHints={totalHints}
            progress={
              <AttemptProgress
                attempts={attempts}
                maxAttempts={effectiveMaxAttempts}
                revealed={ended}
              />
            }
          />
        </div>

        {/* Último intento entre imagen y formulario (fila viva, como el daily). */}
        {phase === "playing" && guesses.length > 0 && (
          <section
            aria-label={t("cdd.lastAttempt")}
            aria-live="polite"
            className="flex flex-col gap-2"
          >
            <span className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
              {t("cdd.lastAttempt")}
            </span>
            <AttemptRow g={guesses[guesses.length - 1]} tolerance={ANIO_CORRECT_MARGIN} fresh />
          </section>
        )}

        {/* Zona de acción: formulario (jugando) o botón de revelado (terminado). */}
        {phase === "loading" ? null : phase === "playing" ? (
          <GuessForm
            onSubmit={submitGuess}
            isSubmitting={isSubmitting}
            guesses={guesses}
            tolerance={ANIO_CORRECT_MARGIN}
          />
        ) : (
          <button className="prensa-submit" onClick={() => setShowEnd(true)}>
            {t("cdd.viewResult")}
          </button>
        )}

        {/* Intentos anteriores (el último ya vive en la fila de arriba durante
            la partida; al terminar se muestran todos, como en el daily). */}
        {(ended ? guesses : guesses.slice(0, -1)).length > 0 && (
          <AttemptList
            guesses={ended ? guesses : guesses.slice(0, -1)}
            pendingGuess={null}
            justRevealedIndex={-1}
            tolerance={ANIO_CORRECT_MARGIN}
          />
        )}
      </main>

      {/* Revelado final: mismas clases cdd-end del daily (banda con foto +
          veredicto + identidad), con el desglose de puntos de la repesca y el
          CTA de vuelta al garaje en el cuerpo. */}
      {showEnd && ended && (
        <div className="cdd-end" role="dialog" aria-modal="true">
          <div className="cdd-end-scrim" onClick={() => setShowEnd(false)} />
          <div className="cdd-end-card">
            <div className="cdd-reveal">
              {car.img && (
                <img
                  src={car.img}
                  alt=""
                  draggable={false}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                />
              )}
              <div className="cdd-reveal-grad" />
              <div className="cdd-reveal-head">
                <div className={"cdd-verdict cdd-mono " + (won ? "win" : "lose")}>
                  {won
                    ? t("cdd.endWin", { n: attempts, max: effectiveMaxAttempts })
                    : t("cdd.endLose", { max: effectiveMaxAttempts })}
                </div>
                {hasReveal ? (
                  <>
                    <div className="cdd-reveal-name">
                      <span className="cdd-reveal-brand">{car.marca}</span>
                      <span className="cdd-reveal-model">{car.modelo}</span>
                    </div>
                    <div className="cdd-reveal-meta cdd-mono">
                      {car.pais && <img className="cdd-flag" src={flagImagePath(car.pais)} alt="" />}
                      {car.pais ? getLocalizedCountry(car.pais) : ""} · {car.anio}
                    </div>
                  </>
                ) : (
                  <div className="cdd-reveal-meta cdd-mono">{t("cdd.lockedAnswer")}</div>
                )}
              </div>
            </div>

            <div className="cdd-end-body">
              {/* Desglose de puntos (propio de la repesca: la mitad, sin racha).
                  Devuelve null si el server no mandó score (p.ej. al recargar
                  una partida ya cerrada). */}
              <ScoreBreakdown score={score} won={won} />

              {/* Recap de la partida: rejilla ✅/❌ (misma que el share del daily,
                  aquí solo como resumen visual — la repesca no se comparte). */}
              <div className="cdd-mono cdd-grid-k">{t("cdd.yourGame")}</div>
              <pre className="cdd-grid">{shareGrid(guesses)}</pre>

              {description && <p className="cdd-note">{description}</p>}

              <button
                className="cdd-submit"
                onClick={() => {
                  window.location.href = "/?garage=true";
                }}
              >
                {t("result.backToGarage")}
              </button>
            </div>

            {/* Cerrar el revelado y volver a ver la partida (mismo enlace
                discreto que el EndScreen del daily). */}
            <div className="cdd-end-links">
              <button
                type="button"
                className="cdd-end-link cdd-mono"
                onClick={() => setShowEnd(false)}
              >
                {t("cdd.seeGame")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
