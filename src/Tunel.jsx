// src/Tunel.jsx
// Página del "Túnel de viento" — modo libre de rejugado.
// Acceso: /tunel (enrutado desde src/index.jsx; CTA en el EndScreen del daily).
//
// Mecánica: el servidor elige un cromo YA desbloqueado del usuario y sirve su
// foto desenfocada al nivel del ÚLTIMO intento (/api/car-image mode=g). El
// cliente añade blur CSS encima para los intentos anteriores (src/lib/blur.js:
// el gaussiano compone, así que pelar el CSS con DevTools solo muestra el
// nivel final). Cada fallo "enfoca" la imagen — focus pull — en lugar de
// alejar el zoom. Sin límite de partidas, sin puntos y sin racha: la
// recompensa es el distintivo AERO por cromo y los contadores.
//
// UI: MISMO lenguaje que el juego diario (stack "configurador Platino"):
// ZoomStage (marco con HUD de cámara), AttemptProgress, AttemptRow/AttemptList
// y un revelado final tipo EndScreen (reutiliza las clases cdd-end existentes,
// sin el equipaje daily: countdown, share, racha). Antes usaba los componentes
// legacy (CarImage suelto + ShiftLights + GuessLog + ResultPanel) y el modo se
// sentía de otra app — feedback del propio autor tras el merge de #78.
//
// A diferencia de Repesca, la imagen NO necesita fetch con Bearer → blob: el
// token AES de la URL ya autoriza y es igual para todos los que jueguen ese
// coche, así que el <img> tira directo y el CDN cachea una vez por coche.

import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import ZoomStage from "./components/configurator/ZoomStage";
import AttemptProgress from "./components/configurator/AttemptProgress";
import AttemptList, { AttemptRow } from "./components/configurator/AttemptList";
import GuessForm from "./components/configurator/GuessForm";
import { useToast } from "./components/Toast";
import { useT, getCarDescription, getLocalizedCountry } from "./i18n";
import { flagImagePath } from "./data/countries";
import { shareGrid } from "./lib/shareText";
import { track } from "./lib/analytics";
import { haptic } from "./lib/haptics";
import { BLUR_ATTEMPTS, cssBlurPxForAttempt } from "./lib/blur.js";

// Réplica del ANIO_CORRECT_MARGIN del servidor (api/_lib/compare-guess.js):
// solo alimenta el texto "±2 años" del campo de año, la validación es server.
const ANIO_CORRECT_MARGIN = 2;

// Ancho por defecto del escenario para el cálculo del blur CSS antes de poder
// medir: columna max-w-md (448px) menos el padding lateral (16px × 2). El
// valor real lo fija la medición del wrapper (el sigma es % del ancho
// RENDERIZADO); desviaciones pequeñas solo alteran ±10% el blur percibido.
const STAGE_DEFAULT_W = 416;

// Zoom fijo durante la partida: NO es pista (no cambia entre intentos), solo
// tapa el halo semitransparente que el filter:blur deja en los bordes de la
// imagen (el overflow-hidden del escenario recorta el 6% extra).
const HALO_MASK_SCALE = 1.06;

// Dirección visual: misma que Configurator.jsx («Prensa del motor», rojo de
// rotativa). El Túnel hereda las variables de .prensa vía los .cdd-* que usa.
const ACCENT = "#b3271b";

export default function Tunel() {
  const { t } = useT();
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [checkingUser, setCheckingUser] = useState(true);

  // Estado del juego. Fases extra respecto a Repesca: "gate" (falta terminar
  // el daily de hoy) y "empty" (pool vacía, con su motivo para elegir copy).
  const [phase, setPhase] = useState("loading"); // loading | gate | empty | playing | won | lost | error
  const [error, setError] = useState("");
  const [emptyReason, setEmptyReason] = useState("no_cars");
  const [guesses, setGuesses] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [reveal, setReveal] = useState(null);
  const [img, setImg] = useState(null); // URL del proxy (mode=g, borrosa)
  const [revealImg, setRevealImg] = useState(null); // URL clear al terminar
  const [blurData, setBlurData] = useState(null); // LQIP
  const [counters, setCounters] = useState({ played: 0, won: 0 });

  // Revelado final como overlay (mismo patrón que Configurator): se auto-abre
  // SOLO en la transición playing → ended de esta sesión, con el mismo delay
  // para que el focus-pull final de la foto respire antes del modal.
  const [showEnd, setShowEnd] = useState(false);
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    const ended = phase === "won" || phase === "lost";
    if (prevPhaseRef.current === "playing" && ended) {
      const id = setTimeout(() => setShowEnd(true), 900);
      prevPhaseRef.current = phase;
      return () => clearTimeout(id);
    }
    prevPhaseRef.current = phase;
  }, [phase]);

  // Ancho renderizado del escenario para el cálculo del blur CSS (ver
  // src/lib/blur.js — el sigma es % del ancho). Re-medimos en resize
  // (rotación móvil).
  const wrapRef = useRef(null);
  const [imgWidth, setImgWidth] = useState(STAGE_DEFAULT_W);
  useEffect(() => {
    function measure() {
      const w = wrapRef.current?.offsetWidth;
      if (w > 0) setImgWidth(w);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [phase]);

  // noindex + título de pestaña (misma disciplina que Repesca).
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const prevTitle = document.title;
    document.title = "Túnel de viento · El Coche del Día";
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

  // Arranca (o reanuda) una partida. Reutilizado por el bootstrap y por el
  // botón "Otro coche" — el servidor decide si es resume o partida nueva.
  async function startGame({ isRetry = false } = {}) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error(t("tunel.errorNeedLogin"));

      // fetch plano: installApiFetchShim (src/index.jsx) ya absolutiza /api
      // en la app nativa; en web es same-origin.
      const res = await fetch("/api/tunel/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 403 && body?.error === "daily_not_finished") {
        setPhase("gate");
        return;
      }
      if (!res.ok) {
        throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
      }
      if (body.counters) setCounters(body.counters);
      if (body.empty) {
        setEmptyReason(body.reason || "no_cars");
        setPhase("empty");
        return;
      }

      const state = body.state || { guesses: [], status: "playing" };
      setGuesses(Array.isArray(state.guesses) ? state.guesses : []);
      setReveal(null);
      setRevealImg(null);
      setImg(body.img || null);
      setBlurData(body.blurData || null);
      setPhase("playing");
      if (!body.resume) track(isRetry ? "tunel_again" : "tunel_start");
    } catch (err) {
      console.error("[Tunel] start:", err);
      setPhase("error");
      setError(err?.message || t("tunel.errorStartFailed"));
    }
  }

  // Bootstrap al resolver la sesión.
  useEffect(() => {
    if (checkingUser) return;
    if (!user) {
      setPhase("error");
      setError(t("tunel.errorNeedLogin"));
      return;
    }
    startGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkingUser, user]);

  const attempts = guesses.length;
  const attemptIndex = Math.min(attempts, BLUR_ATTEMPTS - 1);
  // Blur CSS extra del intento actual (0 en el último: la imagen servida ya
  // es exactamente ese nivel). Al terminar, la foto clear llega sin filtro.
  const blurPx =
    phase === "playing" ? cssBlurPxForAttempt(attemptIndex + 1, imgWidth) : 0;

  const ended = phase === "won" || phase === "lost";
  const won = phase === "won";

  const car = {
    img: ended ? revealImg || img : img,
    blurData,
    marca: reveal?.marca ?? null,
    modelo: reveal?.modelo ?? null,
    anio: reveal?.anio ?? null,
    pais: reveal?.pais ?? null,
    description: reveal?.description ?? null,
    description_en: reveal?.description_en ?? null,
  };
  const hasReveal = Boolean(car.marca && car.modelo && car.anio);
  const description = getCarDescription(car)?.trim();

  async function submitGuess({ guessCarId, anio }) {
    if (phase !== "playing" || isSubmitting) return;
    if (typeof guessCarId !== "string" || !guessCarId) {
      toast.push(t("tunel.errorSelectCar"), { type: "error" });
      return;
    }

    setIsSubmitting(true);
    let response;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers = { "Content-Type": "application/json" };
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      response = await fetch("/api/tunel/validate", {
        method: "POST",
        headers,
        body: JSON.stringify({ guessCarId, anio }),
      });
    } catch (networkErr) {
      console.error("[Tunel] fetch:", networkErr);
      haptic.error();
      toast.push(t("tunel.errorNetworkConnection"), { type: "error" });
      setIsSubmitting(false);
      return;
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      console.error("[Tunel] non-JSON response", response.status);
      haptic.error();
      toast.push(t("tunel.errorInvalidResponse"), { type: "error" });
      setIsSubmitting(false);
      return;
    }

    if (!response.ok) {
      console.error("[Tunel] server error", { status: response.status, data });
      haptic.error();
      toast.push(
        data?.error ? `Error: ${data.error}` : t("tunel.errorValidationFailed"),
        { type: "error" }
      );
      setIsSubmitting(false);
      return;
    }

    try {
      const { result, status, reveal: nextReveal, revealImg: nextRevealImg, counters: nextCounters } = data;
      if (!result) {
        toast.push(t("tunel.errorUnexpectedResponse"), { type: "error" });
        setIsSubmitting(false);
        return;
      }

      setGuesses((prev) => [...prev, result]);
      if (nextReveal) setReveal(nextReveal);
      if (nextRevealImg) setRevealImg(nextRevealImg);
      if (nextCounters) setCounters(nextCounters);

      if (status === "won") {
        haptic.success();
        setPhase("won");
        track("tunel_win", { attempts: data.attemptNumber });
      } else if (status === "lost") {
        haptic.warning();
        setPhase("lost");
        track("tunel_lose");
      }
      return result;
    } catch (err) {
      console.error("[Tunel] post-response error", err);
      haptic.error();
      toast.push(t("tunel.errorProcessingResponse"), { type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  // "Otro coche": el bucle de retención del modo. Sin recargar la página —
  // reseteamos estado y pedimos partida nueva al servidor.
  async function playAgain() {
    if (isRestarting) return;
    haptic.impactLight();
    setIsRestarting(true);
    setShowEnd(false);
    setPhase("loading");
    setImg(null);
    setBlurData(null);
    await startGame({ isRetry: true });
    setIsRestarting(false);
  }

  // ---- Pantallas auxiliares (card centrada, mismo lenguaje que Repesca) ----

  function InfoCard({ kicker, title, body, ctaLabel, ctaHref, tone = "accent" }) {
    const toneText = tone === "red" ? "text-red-400" : "text-accent";
    const toneBorder = tone === "red" ? "border-rojo/40" : "border-accent/30";
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary px-4 font-body text-tinta">
        <div className={`w-full max-w-sm rounded-2xl border ${toneBorder} bg-papel-2 p-6 text-center shadow-2xl`}>
          <p className={`text-[10px] uppercase tracking-[0.28em] ${toneText}`}>{kicker}</p>
          <h1 className="mt-2 font-display text-2xl tracking-widest text-tinta">{title}</h1>
          <p className="mt-3 text-sm text-muted">{body}</p>
          <button
            type="button"
            onClick={() => {
              window.location.href = ctaHref;
            }}
            className="
              mt-5 h-11 w-full rounded-xl bg-accent
              font-display tracking-widest text-bg-primary
              transition hover:brightness-110 active:scale-[0.98]
            "
          >
            {ctaLabel}
          </button>
        </div>
      </div>
    );
  }

  if (checkingUser) {
    return <div className="min-h-screen bg-bg-primary" />;
  }

  if (phase === "error") {
    return (
      <InfoCard
        kicker={t("tunel.errorUnavailable")}
        title={t("tunel.errorTitle")}
        body={error}
        ctaLabel={t("tunel.buttonBackToGame")}
        ctaHref="/"
        tone="red"
      />
    );
  }

  if (phase === "gate") {
    return (
      <InfoCard
        kicker={t("tunel.headerTitle")}
        title={t("tunel.gateTitle")}
        body={t("tunel.gateBody")}
        ctaLabel={t("tunel.gateCta")}
        ctaHref="/"
      />
    );
  }

  if (phase === "empty") {
    const bodyKey =
      emptyReason === "all_done"
        ? "tunel.emptyAllDone"
        : emptyReason === "cooldown"
        ? "tunel.emptyCooldown"
        : "tunel.emptyNoCars";
    return (
      <InfoCard
        kicker={t("tunel.headerTitle")}
        title={t("tunel.emptyTitle")}
        body={t(bodyKey)}
        ctaLabel={t("tunel.buttonBackToGame")}
        ctaHref="/"
      />
    );
  }

  return (
    // Mismo shell visual que el juego diario (Configurator): tema .prensa,
    // con el acento rojo inyectado en --accent — de él beben las clases cdd-*.
    <div className="cdd-app prensa" style={{ "--accent": ACCENT }}>
      {/* Header simple, mismo patrón que Repesca; a la derecha, el marcador
          de victorias del túnel en lugar del spacer. */}
      <header className="border-b border-border bg-bg-primary">
        <div className="mx-auto flex h-14 w-full max-w-md items-center justify-between px-3">
          <button
            type="button"
            onClick={() => {
              window.location.href = "/";
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
            <span>{t("tunel.buttonExit")}</span>
          </button>

          <p className="font-display text-xl tracking-widest text-tinta">
            {t("tunel.headerTitle")}
          </p>

          {/* Marcador: victorias/jugadas del túnel. w fija para que el título
              quede centrado (simetría con el botón de salir). */}
          <span
            className="w-[68px] text-right text-[11px] tabular-nums tracking-wider text-muted"
            title={t("tunel.counterAria")}
            aria-label={t("tunel.counterAria")}
          >
            {counters.played > 0 ? `${counters.won}/${counters.played}` : ""}
          </span>
        </div>
      </header>

      {/* Columna única centrada, calcada del Configurator (max-w-md, gap). */}
      <main className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-5 px-4 pb-10 pt-4 safe-area-pad">
        <div>
          <p className="text-center text-[10px] uppercase tracking-[0.28em] text-accent">
            {t("tunel.modeSubheader")}
          </p>
          <p className="mt-1 text-center text-xs text-muted/80">
            {t("tunel.gameRulesNote")}
          </p>
        </div>

        {/* Escenario con HUD de cámara, como el daily. El progreso de intentos
            es la MISMA barra segmentada (AttemptProgress) — antes ShiftLights,
            un lenguaje visual de otra época del proyecto. Durante "loading"
            (Otro coche) mantenemos status playing con src null: CarImage pinta
            su placeholder y el marco no salta al estado revelado. */}
        <div ref={wrapRef}>
          <ZoomStage
            car={car}
            zoom={phase === "playing" ? HALO_MASK_SCALE : 1.0}
            blurPx={blurPx}
            status={ended ? phase : "playing"}
            hintIndex={phase === "playing" ? attemptIndex : null}
            totalHints={BLUR_ATTEMPTS}
            progress={
              <AttemptProgress
                attempts={attempts}
                maxAttempts={BLUR_ATTEMPTS}
                revealed={ended}
              />
            }
          />
        </div>

        {/* Último intento entre imagen y formulario (calcado del daily). */}
        {phase === "playing" && guesses.length > 0 && (
          <section aria-label={t("cdd.lastAttempt")} aria-live="polite" className="flex flex-col gap-2">
            <span className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
              {t("cdd.lastAttempt")}
            </span>
            <AttemptRow g={guesses[guesses.length - 1]} tolerance={ANIO_CORRECT_MARGIN} fresh />
          </section>
        )}

        {phase === "loading" ? null : phase === "playing" ? (
          <GuessForm
            onSubmit={submitGuess}
            isSubmitting={isSubmitting}
            guesses={guesses}
            tolerance={ANIO_CORRECT_MARGIN}
          />
        ) : (
          <>
            {/* Partida cerrada: el bucle manda. "Otro coche" primario menta;
                reabrir el revelado queda como ghost (mismo par que el daily
                pero con la jerarquía invertida — aquí el modo ES rejugar). */}
            <button
              className="btn btn--mint h-12 w-full rounded-xl"
              onClick={playAgain}
              disabled={isRestarting}
            >
              {isRestarting ? t("tunel.againLoading") : t("tunel.again")}
            </button>
            <button
              className="btn btn--ghost -mt-2 flex h-12 w-full items-center justify-center rounded-xl"
              onClick={() => setShowEnd(true)}
            >
              {t("cdd.viewResult")}
            </button>
          </>
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

      {/* Revelado final: mismas clases cdd-end del EndScreen del daily, sin su
          equipaje (countdown/share/racha/opt-in). La banda muestra la foto ya
          nítida + veredicto + identidad; el cuerpo, la rejilla de la partida y
          el CTA del bucle. */}
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
                    ? t("cdd.endWin", { n: attempts, max: BLUR_ATTEMPTS })
                    : t("cdd.endLose", { max: BLUR_ATTEMPTS })}
                </div>
                {hasReveal && (
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
                )}
              </div>
            </div>

            <div className="cdd-end-body">
              <div className="cdd-mono cdd-grid-k">{t("cdd.yourGame")}</div>
              <pre className="cdd-grid">{shareGrid(guesses)}</pre>
              {description && <p className="cdd-note">{description}</p>}
              <button className="cdd-submit" onClick={playAgain} disabled={isRestarting}>
                {isRestarting ? t("tunel.againLoading") : t("tunel.again")}
              </button>
            </div>

            <button className="cdd-end-close cdd-mono" onClick={() => setShowEnd(false)}>
              {t("cdd.seeGame")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
