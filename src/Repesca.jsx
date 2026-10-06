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
// La rejilla de la partida es la del panel final del juego diario: los dos
// paneles resumen lo mismo y con el mismo dibujo.
import { Rejilla } from "./components/configurator/EndScreen";
import { useToast } from "./components/Toast";
import { useSelloSentido } from "./hooks/useSelloSentido";
import { useT, getCarDescription, getLocalizedCountry } from "./i18n";
import { flagImagePath } from "./data/countries";
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
const ACCENT = "var(--rojo)";
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
  // La fila entintada mientras el servidor decide, igual que en el juego diario
  // (ver Configurator). La repesca comparte GuessForm, así que compartir también
  // el acuse de recibo es lo que impide que las dos partidas se sientan de
  // aplicaciones distintas.
  const [pendingGuess, setPendingGuess] = useState(null);
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
  // ¿Se ha abierto solo, al acabar ahora? Decide si el sello hace sentir el
  // final; reabrirlo con «Ver resultado» lo apaga (mismo trato que el daily).
  const [finalRecien, setFinalRecien] = useState(false);
  // ¿La partida ha terminado EN ESTA SESIÓN? Con ella cerrada, el último intento
  // deja la fila viva y pasa a la lista; sin esto pasaba sin estampar, y la
  // frase háptica del veredicto sonaba sobre una fila que ya estaba quieta. Se
  // enciende en submitGuess, en el MISMO lote que `setPhase`: desde un efecto
  // llegaría un frame tarde y la fila se vería un instante antes de entintarse.
  const [terminadaAqui, setTerminadaAqui] = useState(false);
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    const isEnded = phase === "won" || phase === "lost";
    if (prevPhaseRef.current === "playing" && isEnded) {
      const id = setTimeout(() => {
        setFinalRecien(true);
        setShowEnd(true);
      }, 900);
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
  const alEstamparSello = useSelloSentido({ won, activo: finalRecien });
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

  async function submitGuess({ guessCarId, anio, marca, modelo }) {
    if (phase !== "playing" || isSubmitting) return;
    if (typeof guessCarId !== "string" || !guessCarId) {
      toast.push(t("repesca.errorSelectCar"), { type: "error" });
      return;
    }

    setIsSubmitting(true);
    // Con lo que el jugador acaba de elegir: la fila existe desde el toque, no
    // desde la respuesta. `marca`/`modelo` los manda GuessForm aunque el
    // servidor de la repesca solo necesite `guessCarId` — aquí es donde sirven.
    setPendingGuess({
      marca: { val: marca || "" },
      modelo: { val: modelo || "" },
      anio: { val: anio ? String(anio) : "" },
    });
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
      setPendingGuess(null);
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
      setPendingGuess(null);
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
      setPendingGuess(null);
      setIsSubmitting(false);
      return;
    }

    try {
      const { result, reveal: nextReveal, score: scoreBreakdown } = data;
      if (!result) {
        toast.push(t("repesca.errorUnexpectedResponse"), { type: "error" });
        setPendingGuess(null);
        setIsSubmitting(false);
        return;
      }

      const newGuesses = [...guesses, result];
      let newPhase = "playing";
      if (result.win) newPhase = "won";
      else if (newGuesses.length >= effectiveMaxAttempts) newPhase = "lost";

      // La misma frase que en la partida diaria (ver useGame.js): un golpe por
      // celda con la tinta, y el cierre —acierto o derrota— cuando el sello
      // del revelado toca el papel, no al llegar la respuesta.
      haptic.veredicto(result);

      setGuesses(newGuesses);
      setPhase(newPhase);
      if (newPhase !== "playing") setTerminadaAqui(true);
      if (nextReveal) setReveal(nextReveal);
      if (scoreBreakdown && newPhase !== "playing") setScore(scoreBreakdown);

      // Analytics: resultado de la repesca con su modo (normal/veteran).
      if (newPhase === "won") {
        track("repesca_win", { mode, attempts: newGuesses.length });
      } else if (newPhase === "lost") {
        track("repesca_lose", { mode });
      }

      return result;
    } catch (err) {
      console.error("[Repesca] post-response error", err);
      haptic.error();
      toast.push(t("repesca.errorProcessingResponse"), { type: "error" });
    } finally {
      setPendingGuess(null);
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
    // Una tarjeta de decisión centrada (las mismas piezas que los diálogos,
    // dlg-*): qué ha pasado, por qué, y la única salida, de vuelta al juego.
    return (
      <div className="rep-error safe-area-pad">
        <div className="rep-error-tarjeta dlg">
          <span className="arch-kicker ambar">{t("repesca.errorUnavailable")}</span>
          <h1 className="dlg-titulo">{t("repesca.errorMismatchTitle")}</h1>
          <p className="dlg-texto">{error}</p>
          <button
            type="button"
            className="pm-btn"
            onClick={() => {
              window.location.href = "/";
            }}
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
      {/* ── LA CABECERA DE LA REPESCA ────────────────────────────────────────
          Tres huecos, como en el diseño: la vuelta al Archivo a la izquierda
          (con su nombre: «Salir» no decía adónde), «Repesca» con su icono en el
          centro y, a la derecha, el modo cuando hay algo que declarar — el
          Veterano, en oro. En modo normal ese hueco va vacío: no hay nada que
          decir que no diga la tira de reglas de debajo.

          No lleva fecha: lo que se juega aquí es un coche de OTRO día, y
          ponerle la de hoy sería mentir sobre qué número es este.

          `safe-area-top`: la repesca ocupa la pantalla entera con cabecera
          propia, así que en la app —edge-to-edge— sin el inset se dibujaría
          bajo la barra de estado. */}
      <header className="rep-cab safe-area-top" style={{ "--safe-area-extra-top": "0.25rem" }}>
        <button
          type="button"
          className="rep-volver"
          onClick={() => {
            haptic.impactLight();
            window.location.href = "/?garage=true";
          }}
        >
          <Icon d={I.chevL} size={20} />
          {t("prensa.garaje")}
        </button>
        <span className="rep-titulo">
          <Icon d={I.shuffle} size={19} />
          {t("repesca.titulo")}
        </span>
        <span className="rep-modo">
          {isVeteran && (
            <span className="rep-modo-chip">
              <Icon d={I.galones} size={14} strokeWidth="2" />
              {t("repesca.veteranSello")}
            </span>
          )}
        </span>
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
        {/* LO QUE CUESTA ESTA PARTIDA, en una tira ámbar (el color de la
            repesca): la mitad de puntos, la racha a salvo y que es una al día.
            Lo único que el jugador no puede deducir mirando la pantalla. */}
        {!isVeteran && (
          <div className="rep-reglas" role="note">
            <span><span className="medio" aria-hidden="true">½</span>{t("repesca.reglaPuntos")}</span>
            <i aria-hidden="true" />
            <span><Icon d={I.escudo} size={14} />{t("repesca.reglaRacha")}</span>
            <i aria-hidden="true" />
            <span>{t("garage.reglaUnaAlDia")}</span>
          </div>
        )}

        {/* EL MODO VETERANO: las reglas duras, en oro (es una condición que se
            gana, no un aviso). */}
        {isVeteran && phase === "playing" && (
          <section className="rep-veterano" role="note" aria-label={t("repesca.veteranBadge")}>
            <div className="rep-veterano-cab">
              <span className="rep-veterano-texto">
                <b>
                  <Icon d={I.galones} size={22} strokeWidth="2" />
                  {t("repesca.veteranBadge")}
                </b>
                <span>{t("repesca.veteranSub")}</span>
              </span>
            </div>
            <div className="rep-veterano-chips">
              <span>{t("repesca.chipIntento")}</span>
              <span>{t("repesca.chipPistas")}</span>
              <span>{t("repesca.chipAnio")}</span>
            </div>
          </section>
        )}

        {/* Escenario con ladillo/pie editorial, como el daily. Envuelto en un
            div para neutralizar el order:2 de .prensa-area-foto en esta columna
            flex (el order solo aplica entre hermanos flex, y aquí el <section>
            es hijo único del div). */}
        <div className={"rep-foto" + (isVeteran ? " veterano" : "")}>
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

        {/* Último intento entre imagen y formulario (fila viva, como el daily).
            Mientras el servidor decide, la fila la ocupa el intento PENDIENTE
            —entintado, sin veredicto— y al llegar la respuesta se estampa en su
            sitio. Antes desaparecía el anterior y reaparecía el nuevo ya
            juzgado, sin nada en medio. */}
        {phase === "playing" && (pendingGuess || guesses.length > 0) && (
          <section
            aria-label={t("cdd.lastAttempt")}
            aria-live="polite"
            className="flex flex-col gap-2"
          >
            <span className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
              {t("cdd.lastAttempt")}
            </span>
            {pendingGuess ? (
              <AttemptRow g={pendingGuess} tolerance={ANIO_CORRECT_MARGIN} pending />
            ) : (
              <AttemptRow g={guesses[guesses.length - 1]} tolerance={ANIO_CORRECT_MARGIN} fresh />
            )}
          </section>
        )}

        {/* Zona de acción: formulario (jugando) o botón de revelado (terminado). */}
        {phase === "loading" ? null : phase === "playing" ? (
          <>
            <GuessForm
              onSubmit={submitGuess}
              isSubmitting={isSubmitting}
              guesses={guesses}
              tolerance={ANIO_CORRECT_MARGIN}
              mantener={isVeteran}
            />
            {isVeteran && <p className="rep-mantener-nota">{t("repesca.mantenNota")}</p>}
          </>
        ) : (
          <button className="prensa-submit" onClick={() => { setFinalRecien(false); setShowEnd(true); }}>
            {t("cdd.viewResult")}
          </button>
        )}

        {/* Intentos anteriores (el último ya vive en la fila de arriba durante
            la partida; al terminar se muestran todos, como en el daily). */}
        {(ended ? guesses : guesses.slice(0, -1)).length > 0 && (
          <AttemptList
            guesses={ended ? guesses : guesses.slice(0, -1)}
            pendingGuess={null}
            // El último intento se estampa al cerrar la partida aquí mismo: es
            // el que la frase háptica está marcando (ver `terminadaAqui`).
            justRevealedIndex={ended && terminadaAqui ? guesses.length - 1 : -1}
            tolerance={ANIO_CORRECT_MARGIN}
          />
        )}
      </main>

      {/* EL PANEL FINAL de la repesca: el mismo objeto que el del juego diario
          (clases fin-*), con lo que es propio de aquí — los puntos a la mitad,
          sin racha, y la vuelta al Archivo como acción principal. */}
      {showEnd && ended && (
        <div className="cdd-end" role="dialog" aria-modal="true" aria-label={t("cdd.endScreenAria")}>
          <div className="cdd-end-scrim" onClick={() => setShowEnd(false)} />
          <div className="cdd-end-card fin">
            <div className="cdd-end-topbar">
              <button
                type="button"
                className="cdd-end-close"
                aria-label={t("cdd.seeGame")}
                onClick={() => { haptic.impactLight(); setShowEnd(false); }}
              >
                <Icon d={I.x} size={20} />
              </button>
            </div>

            <div className="fin-foto">
              {car.img && <img src={car.img} alt="" draggable={false} className="fin-foto-img" />}
              <div className={"prensa-sello" + (won ? "" : " tinta")} aria-hidden="true" onAnimationStart={alEstamparSello}>
                {won ? (
                  <>
                    <Icon d={I.check} size={15} />
                    {t("fin.resueltoEn", { n: attempts, max: effectiveMaxAttempts })}
                  </>
                ) : (
                  <>
                    <Icon d={I.x} size={14} />
                    {t("prensa.selloLose")}
                  </>
                )}
              </div>
            </div>

            <header className="fin-titulo fin-entra">
              <span className="fin-kicker">{isVeteran ? t("repesca.veteranBadge") : t("repesca.titulo")}</span>
              {hasReveal ? (
                <>
                  <h2 className="fin-coche">{car.marca} {car.modelo}</h2>
                  <div className="fin-chapas">
                    {car.pais && (
                      <span className="fin-chapa">
                        <img className="bandera" src={flagImagePath(car.pais)} alt="" />
                        {getLocalizedCountry(car.pais)}
                      </span>
                    )}
                    <span className="fin-chapa mono">{car.anio}</span>
                  </div>
                </>
              ) : (
                <p className="fin-sin-ficha">{t("cdd.revealUnavailable")}</p>
              )}
            </header>

            {won ? (
              <section className="fin-tarjeta fin-entra" aria-label={t("score.yourScore")}>
                <div className="fin-marcador">
                  <div className="fin-marcador-cifra">
                    <span className="fin-etiqueta">{t("repesca.puntos")}</span>
                    {score ? (
                      <span className="fin-puntos">
                        {score.totalPoints}
                        <small>{t("score.points")}</small>
                      </span>
                    ) : (
                      <span className="fin-puntos fin-puntos--sin">—</span>
                    )}
                  </div>
                  <Rejilla guesses={guesses} />
                </div>
                <p className="rep-fin-nota">
                  {isVeteran ? t("repesca.finVeterano") : t("repesca.finMitad")}
                </p>
              </section>
            ) : (
              <section className="fin-tarjeta fin-fila fin-entra">
                <span className="fin-icono ambar" aria-hidden="true">
                  <Icon d={I.shuffle} size={19} />
                </span>
                <span className="fin-fila-texto">
                  <b>{t("repesca.finPerdidaTitulo")}</b>
                  <span>{t("repesca.finPerdidaTexto")}</span>
                </span>
              </section>
            )}

            {won && hasReveal && description && (
              <section className="fin-tarjeta fin-entra">
                <h3 className="fin-tarjeta-titulo">{t("fin.ficha")}</h3>
                <p className="cdd-note">{description}</p>
              </section>
            )}

            <div className="fin-acciones fin-entra">
              <button
                className="cdd-submit"
                onClick={() => {
                  window.location.href = "/?garage=true";
                }}
              >
                {t("result.backToGarage")}
              </button>
            </div>

            <div className="cdd-end-links">
              <button type="button" className="cdd-end-link" onClick={() => setShowEnd(false)}>
                {t("cdd.seeGame")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
