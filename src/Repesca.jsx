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
// El set de iconos de línea compartido (trazo 1.6, caja 24): la salida de la
// cabecera usa el mismo chevrón que el resto de la app.
import { Icon, I } from "./components/configurator/icons";
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
// El pie de la partida es un componente compartido con el fin de partida del
// daily: los dos paneles resumen lo mismo y antes cada uno lo dibujaba a su
// manera (aquí, una píldora de texto sobre la foto y una rejilla de emoji).
import { PiePartida } from "./components/configurator/EndScreen";
import { useToast } from "./components/Toast";
import { useT, getCarDescription, getLocalizedCountry } from "./i18n";
import { flagImagePath } from "./data/countries";
import { notifyAchievementsAfterWin } from "./lib/achievementsNotifier";
import { track, plataforma } from "./lib/analytics";
import { captureClientError } from "./lib/sentry";
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
        // Marcado, no identificado por su texto: el `catch` decide qué se le
        // enseña al jugador y necesita distinguir el caso sin leer mensajes.
        if (!session?.access_token) {
          const e = new Error("sin sesión");
          e.sinSesion = true;
          throw e;
        }

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
        // A Sentry TAMBIÉN. Este catch pinta la pantalla de error entera de la
        // repesca, y hasta ahora solo dejaba rastro en una consola que nadie
        // mira: el 12-ago un jugador se quedó sin repesca aquí y no hubo forma
        // de saber qué vio. El caso "sin sesión" no viaja — es un estado
        // esperado, no una avería, y llenaría la cuota del free tier.
        if (!err?.sinSesion) {
          captureClientError(err, { flujo: "repescaBootstrap", plataforma: plataforma() });
        }
        setPhase("error");
        // EL MENSAJE TÉCNICO SE QUEDA EN LA CONSOLA. Aquí se pintaba
        // `err.message`, y ninguno de los tres que llegan está escrito para
        // leerse: el `detail` crudo del backend, un `HTTP 500`, o el texto del
        // navegador cuando cae la red («Failed to fetch», en inglés juegue quien
        // juegue). Y esto no es una esquina: es la pantalla ENTERA de la
        // repesca, con su titular y su botón. Quien depura ya lo tiene arriba.
        setError(err?.sinSesion ? t("repesca.errorNeedLogin") : t("repesca.errorStartFailed"));
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
        // Este fallo es el más traicionero de los tres: no pinta ningún error,
        // deja el skeleton para siempre. En Modo Veterano —un intento y sin
        // pistas— la pantalla se queda sin NADA que mirar, y desde fuera es
        // indistinguible de "la repesca no funciona". Va a Sentry por eso.
        // El volumen está acotado por diseño: una repesca por jugador y día.
        captureClientError(err, { flujo: "repescaImagen", plataforma: plataforma() });
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
        {/* Esquina viva y filete de rojo, sin `shadow-2xl`: es un recuadro de
            errata impreso en el papel, no una tarjeta flotante. */}
        <div className="w-full max-w-sm rounded-none border border-rojo/40 bg-papel-2 p-6 text-center">
          <p className="text-[10px] uppercase tracking-[0.28em] text-rojo">
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
            // Mismo botón de tinta que el resto del sistema: esquina viva, vuelco
            // a rojo al pasar (no `brightness-110`, que aclara el color en vez de
            // cambiarlo) y hundido de 1px al pulsar.
            className="
              mt-5 h-11 w-full rounded-none bg-tinta
              font-display tracking-widest text-papel
              transition-colors hover:bg-rojo active:translate-y-px
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
      {/* ── LA CABECERA ES LA DEL PERIÓDICO, NO UNA BARRA PROPIA ─────────────
          Aquí había una barra escrita en utilidades sueltas —chip enmarcado de
          SALIR a la izquierda, «REPESCA» en Fraunces centrado, y un spacer
          fantasma de 68px a la derecha para fingir el centrado—. Tres problemas
          en tres líneas de JSX:

            · La app tenía TRES gramáticas de barra superior (esta, la del juego
              y la del Archivo). Nada hace que una app parezca tres apps más
              rápido que cambiar de objeto en la esquina por la que entra el ojo.
            · El chip era lo más pesado de la pantalla —marco, borde, chevrón y
              palabra: tres señales— para la acción MENOS usada de la página.
            · El centrado era falso: dependía de que «SALIR» midiera 68px. En
              inglés («Exit») el chip encoge y el título se desplaza solo.

          Ahora es `.prensa-topbar`, la misma barra del juego, con la misma
          gramática de tres huecos: [salida] [titulillo de sección] … [estado].
          La salida ocupa el sitio y la medida exactos de la marca del sumario
          —34px, área táctil de 50, sin marco— así que la esquina superior
          izquierda es UN solo objeto en toda la app: en el juego abre el
          ejemplar, aquí vuelve al Archivo.

          El titulillo NO lleva fecha, a diferencia del folio del juego: lo que
          se juega en la repesca es un coche de OTRO día, y ponerle la fecha de
          hoy sería mentir sobre qué ejemplar es este.

          A la derecha, el hueco que en el juego ocupa la clasificación se lo
          queda el modo: VETERANO estampado en oro (`pm-sello--oro`, el sello
          que el sistema ya reserva a lo premium). Con eso desaparece el kicker
          rojo centrado que decía lo mismo 40px más abajo. En modo normal el
          hueco va vacío a propósito: no hay nada que declarar, y el ladillo de
          la foto ya lleva la pista.

          `safe-area-top`: la repesca ocupa la pantalla entera con cabecera
          propia, así que esta barra empieza en y=0 y en la app —edge-to-edge—
          se dibujaba BAJO la barra de estado. Los 6px de extra son el mismo
          aire que se le da al pliego del juego bajo el reloj del sistema. */}
      <header className="safe-area-top" style={{ "--safe-area-extra-top": "0.375rem" }}>
        {/* El margen horizontal va en este envoltorio y no en la barra: la
            regla `.prensa-topbar` fija `padding` en shorthand y, como vive
            después de `@tailwind utilities`, se comería cualquier `px-4`. */}
        <div className="mx-auto w-full max-w-md px-4">
          <nav className="prensa-topbar" aria-label={t("prensa.navAria")}>
            <span>
              <button
                type="button"
                className="prensa-sumario-boton"
                aria-label={t("repesca.buttonExit")}
                onClick={() => {
                  haptic.impactLight();
                  window.location.href = "/?garage=true";
                }}
              >
                <Icon d={I.chevL} size={18} />
              </button>
              <span className="prensa-folio-barra">{t("repesca.headerTitle")}</span>
            </span>

            <span>
              {/* UNA palabra, no «Modo Veterano»: el sello va inclinado, así
                  que su caja crece con el largo del texto por los dos ejes a la
                  vez. Con las dos palabras ocupaba casi la mitad de la barra y
                  su esquina bajaba a rozar el doble filete — dejaba de leerse
                  como un sello estampado y pasaba a pegatina. «Veterano» junto
                  a «REPESCA» dice sección y modo en el mismo golpe de vista, y
                  el matiz completo lo da la nota de abajo. */}
              {isVeteran && (
                <span className="pm-sello pm-sello--oro">{t("repesca.veteranSello")}</span>
              )}
            </span>
          </nav>
        </div>
      </header>

      {/* El h1 de verdad (SEO y lectores de pantalla), como en el juego: el
          titulillo de la barra es la marca VISUAL de la sección. */}
      <h1 className="sr-only">{t("repesca.headerTitle")}</h1>

      {/* Columna única centrada, calcada del Configurator (max-w-md, gap). */}
      {/* El cuerpo solo se queda con el inset de ABAJO (la barra de gestos); el
          de arriba se lo ha llevado la cabecera.
          El 1rem de abajo va en la variable porque `.safe-area-bottom` pisaría
          una utilidad de Tailwind. Y es 1rem, no los 2.5rem que pedía el `pb-10`
          que había aquí: ese `pb-10` NUNCA llegó a aplicarse —`.safe-area-pad`
          lo pisaba con su `1rem + inset`, el mismo mordisco que documenta
          `.prensa-hoja`—, así que 1rem es lo que la página lleva viéndose desde
          siempre. Cambiarlo ahora sería colar un ajuste de maqueta en un arreglo
          de otra cosa; si algún día se quiere el aire que pedía el pb-10, se
          sube esta variable a 2.5rem y se mira. */}
      <main
        className="safe-area-bottom mx-auto flex w-full max-w-md min-w-0 flex-col gap-5 px-4 pt-4"
        style={{ "--safe-area-extra-bottom": "1rem" }}
      >
        {/* LA NOTA DE LA SECCIÓN: qué cuesta esta partida, y nada más.
            Aquí vivía además un kicker centrado en rojo que repetía el modo
            («MODO VETERANO» / «Modo Repesca · una al día») justo debajo de una
            cabecera que ya lo decía. Con el sello en la barra, el kicker era la
            tercera vez que se nombraba lo mismo en 40px. En modo normal se
            conserva lo único que el jugador no puede deducir: que los puntos
            van a la mitad. */}
        {!isVeteran && (
          <p className="text-center text-xs text-muted/80">
            {t("repesca.gameRulesNote")}
          </p>
        )}

        {/* Nota veterano: reglas más duras (1 intento, sin pistas). */}
        {isVeteran && phase === "playing" && (
          // Recuadro de aviso editorial: filete grueso a la izquierda (el
          // "destacado" de una columna de periódico) sobre papel, en vez de la
          // caja ámbar redondeada con icono que había antes — ámbar crudo de
          // Tailwind del tema anterior, que sobre papel se leía como un post-it.
          // El oro marca que esto es una condición premium, no una advertencia.
          <div
            className="
              border-l-2 border-oro-viejo bg-papel-2 px-3 py-2
              font-serif text-[12px] leading-snug text-tinta
            "
            role="note"
          >
            {/* Sin etiqueta propia: el kicker de arriba ya dice "Modo
                Veterano" y repetirlo aquí sonaba a tartamudeo. El filete de
                oro es la etiqueta. */}
            {t("repesca.veteranExplain")}
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
              {/* El sello del veredicto, igual que en el fin de partida del daily:
                  los dos paneles son el mismo objeto y hasta ahora la repesca no
                  tenía celebración — solo una píldora de texto sobre la foto. */}
              <div className={"prensa-sello" + (won ? "" : " tinta")} aria-hidden="true">
                {won ? t("prensa.selloWin") : t("prensa.selloLose")}
              </div>
              <div className="cdd-reveal-grad" />
              <div className="cdd-reveal-head">
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
                  <div className="cdd-reveal-meta cdd-mono">{t("cdd.revealUnavailable")}</div>
                )}
              </div>
            </div>

            {/* El pie de la partida, el mismo componente que el fin de partida del
                daily. Sin percentil: la repesca no tiene estadística del día. */}
            <PiePartida won={won} attempts={attempts} max={effectiveMaxAttempts} />

            <div className="cdd-end-body">
              {/* Desglose de puntos (propio de la repesca: la mitad, sin racha).
                  Devuelve null si el server no mandó score (p.ej. al recargar
                  una partida ya cerrada). */}
              <ScoreBreakdown score={score} won={won} />

              {/* (Aquí se pintaba la rejilla ✅/❌ con `shareGrid`, y era el caso
                  más flagrante de los dos paneles: su propio comentario decía «la
                  repesca no se comparte», así que esos cuadros de emoji dibujados
                  por el sistema operativo no tenían ni la excusa del portapapeles
                  — eran decoración pura, y la más ruidosa de la pantalla. El
                  recuento vive en el pie de arriba y los intentos, uno a uno, en
                  el historial que queda detrás del panel.) */}

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
