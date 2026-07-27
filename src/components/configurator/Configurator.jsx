// src/components/configurator/Configurator.jsx
// Pantalla de juego rediseñada ("configurador premium", dirección Platino).
// Ensambla header + intro + escenario (foto con HUD) + intentos + formulario o
// botón de resultado, y el revelado cinematográfico (EndScreen) como overlay.
// La lógica de juego vive en useGame (App) y llega por props.

import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { useCountdown } from "../../hooks/useCountdown";
import { useEncajeEscenario } from "../../hooks/useEncajeEscenario";
import Header from "./Header";
import EdicionNoDisponible from "./EdicionNoDisponible";
import ZoomStage from "./ZoomStage";
import PhotoPeek from "./PhotoPeek";
import AttemptList, { AttemptRow } from "./AttemptList";
import GuessForm from "./GuessForm";
import EndScreen from "./EndScreen";
import NotaRedaccion from "./NotaRedaccion";
import { useDailyStats, Distribution } from "./dailyStats";

// Dirección visual «Prensa del motor»: papel + tinta + rojo de rotativa. El
// tema/acento dejan de ser configurables (el periódico tiene UNA identidad);
// las props theme/accent se ignoran y se retiran del todo en F5.
const DEFAULT_THEME = "prensa";
const DEFAULT_ACCENT = "#b3271b";

export default function Configurator({
  dataReady = true,
  // Fallo de la carga inicial SIN nada cacheado que enseñar. Cuando llega,
  // sustituye al escenario de la foto (que si no se quedaría en skeleton
  // eterno) y conserva el resto del pliego: la cabecera sigue viva, así que
  // GARAJE / RANKING / ENTRAR se pueden seguir usando sin red.
  loadError = null,
  onRetryLoad,
  // `isLoading` de useGame: en un reintento vuelve a true, y es lo que apaga el
  // botón para que no se pueda disparar cinco veces seguidas.
  isRetryingLoad = false,
  car,
  status,
  zoom,
  hintIndex,
  totalHints,
  guesses,
  pendingGuess,
  justRevealedIndex = -1,
  attempts,
  maxAttempts,
  tolerance = 2,
  isSubmitting,
  submitGuess,
  streak,
  rank,
  rankCargando = false,
  user,
  repescaAlert,
  shareText,
  revealReady, // eslint-disable-line no-unused-vars -- reservado
  onRevealLoad,
  onOpenProfile,
  onOpenLogin,
  onOpenRanking,
  onOpenGarage,
  onOpenHowTo,
  howtoPulse = false,
  theme = DEFAULT_THEME,
  accent = DEFAULT_ACCENT,
}) {
  const { t, locale } = useT();
  const ended = status !== "playing";
  const won = status === "won";

  // Onboarding del recién llegado: la fila de intro (subtítulo "Adivina marca,
  // modelo y año" + "?") se pinta SOLO en la primera visita. El día a día queda
  // con la barra limpia (sin subtítulo ni "?"). Lectura SÍNCRONA de localStorage
  // en el initializer para que la decisión sea correcta en el primer render —
  // si esperásemos a un useEffect, la fila aparecería de golpe (CLS). El flag se
  // marca al montar, así que la intro se ve una vez y desaparece para siempre.
  // El chip "¿Cómo se juega?" de primera visita se eliminó a petición; el acceso
  // a las reglas vive permanentemente en el footer (botón "Cómo se juega").

  // Revelado: se auto-abre SOLO cuando la partida termina en esta sesión
  // (transición playing → ended). Si el usuario llega con la partida ya cerrada,
  // mostramos el botón "VER REVELADO/RESPUESTA" en vez de saltar el overlay.
  const [showEnd, setShowEnd] = useState(false);
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "playing" && ended) {
      const id = setTimeout(() => setShowEnd(true), 900);
      prevStatus.current = status;
      return () => clearTimeout(id);
    }
    prevStatus.current = status;
  }, [status, ended]);

  // Conector del H1 según idioma ("marca, modelo y/and año").
  const conn = locale === "es" ? "y" : "and";

  // El «recorte» (PhotoPeek): cuando el escenario sale del viewport en plena
  // partida —el caso real es el teclado móvil abierto sobre el cupón—, una
  // miniatura fija mantiene la referencia visual del coche. El v0 lo retiró
  // apostando por "scroll natural", pero sin él el jugador tecleaba marca y
  // modelo a ciegas (auditoría UX 2026-07). Observamos la sección de la foto
  // con un IntersectionObserver de umbral 0.25: con menos de un cuarto de la
  // foto a la vista, la referencia ya no sirve y entra el recorte.
  const fotoRef = useRef(null);
  const [fotoVisible, setFotoVisible] = useState(true);
  useEffect(() => {
    // Solo durante la partida y con datos: al revelar, la foto entera manda y
    // el recorte sobra. `IntersectionObserver` falta en algún WebView viejo:
    // sin él simplemente no hay recorte (mejora progresiva, regla 9).
    if (!dataReady || ended) return;
    const el = fotoRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setFotoVisible(entry.isIntersecting),
      { threshold: 0.25 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      // Al desconectar (fin de partida), la miniatura no debe quedar colgada.
      setFotoVisible(true);
    };
  }, [dataReady, ended]);

  // Encaje del escenario: capa el ANCHO de la foto (nunca el alto — el 4:3 es
  // intocable, reglas 5 y 7) lo justo para que el botón ADIVINAR entre entero
  // en pantalla al abrir. Solo mide en el primer turno: después aparece la fila
  // viva y volver a encoger la foto a media partida sería peor que perder el
  // botón de vista. Detalle completo en el hook.
  const hojaRef = useRef(null);
  const jugarRef = useRef(null);
  const anchoEscenario = useEncajeEscenario({
    fotoRef,
    jugarRef,
    hojaRef,
    activo: dataReady && !ended && guesses.length === 0 && !pendingGuess,
  });

  // Tap en el recorte: cerrar el teclado y devolver el escenario al viewport.
  function volverALaFoto() {
    document.activeElement?.blur?.();
    fotoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Historial bajo el formulario: SOLO los intentos anteriores al que ya muestra
  // la "fila viva" de arriba (calcado del guess-history de v0, que recibe
  // olderGuesses). Con partida terminada o intento pendiente, se muestran todos.
  const olderGuesses =
    ended || pendingGuess ? guesses : guesses.slice(0, -1);

  // La estadística del día como bloque de página (columna izquierda del
  // broadsheet / final en móvil). GATEADA a partida cerrada: el hook ni
  // siquiera pide los datos mientras se juega (no chivar la dificultad).
  const daily = useDailyStats(attempts, won, ended);

  // Reloj del pie: "CIERRE DE EDICIÓN EN hh:mm:ss" (medianoche Madrid). El
  // mismo hook que usa el EndScreen — dos consumidores, un solo intervalo por
  // montaje, coste despreciable.
  const countdown = useCountdown();

  return (
    // Los tokens del sistema viven en :root (día) y :root[data-tema="noche"]
    // (index.css); .prensa solo aporta tipografía y lienzo. --accent se sigue
    // inyectando porque focus-ring y piezas .cdd-* lo consumen, y apunta a
    // var(--rojo) para que también siga el tema (día/noche).
    <div className="cdd-app prensa" style={{ "--accent": "var(--rojo)" }}>
      {/* El pliego: columna única en móvil (orden del DOM) y broadsheet de 3
          columnas ≥1100px vía grid-template-areas (.prensa-pliego). La columna
          "clas" agrupa fila viva + historial + estadística con display:contents
          en móvil (sus hijos fluyen sueltos con su propio `order`) y como
          bloque real en el pliego ancho.
          Sin `safe-area-pad`: aquí no hacía nada (el `padding` de .prensa-hoja
          la pisaba por orden de cascada) y daba la falsa sensación de que el
          inset del sistema estaba resuelto. Ahora lo aplica .prensa-hoja. */}
      <main
        ref={hojaRef}
        className="prensa-hoja prensa-pliego flex min-h-screen flex-col gap-3"
        // El cap que calcula useEncajeEscenario. Va como variable en el pliego
        // (no como estilo del marco) para que la consuma el CSS del sistema y
        // el marco siga siendo cosa de CarImage.
        //
        // Al TERMINAR se suelta: el cap existe para proteger el botón ADIVINAR
        // y, acabada la partida, ese botón ya no está. El revelado recupera
        // todo el ancho, que es justo lo que promete su propio pie de foto —
        // «el ejemplar de hoy, por fin a plena página».
        style={
          anchoEscenario && !ended
            ? { "--cdd-marco-max": `${anchoEscenario}px` }
            : undefined
        }
      >
        <Header
          rank={rank}
          rankCargando={rankCargando}
          user={user}
          repescaAlert={repescaAlert}
          onOpenProfile={onOpenProfile}
          onOpenLogin={onOpenLogin}
          onOpenRanking={onOpenRanking}
          onOpenGarage={onOpenGarage}
        />

        {/* H1 real solo para lectores de pantalla/SEO (v0 no lo pinta). */}
        <h1 className="sr-only">
          {t("cdd.guess")} {t("cdd.wordMarca")}, {t("cdd.wordModelo")} {conn}{" "}
          {t("cdd.wordAnio")}
        </h1>

        {loadError ? (
          <EdicionNoDisponible onRetry={onRetryLoad} isRetrying={isRetryingLoad} />
        ) : (
          <ZoomStage
            car={car}
            zoom={zoom}
            status={status}
            hintIndex={hintIndex}
            totalHints={totalHints}
            blurred={status === "lost" && !user}
            onRevealLoad={onRevealLoad}
            sectionRef={fotoRef}
          />
        )}

        {/* El recorte flotante: solo en partida y con la foto fuera de vista.
            El CSS lo oculta en el pliego ancho (≥1100px): allí la foto es la
            columna central y no se pierde. z-50, bajo EndScreen y modales. */}
        {dataReady && !ended && !fotoVisible && (
          <PhotoPeek src={car?.img ?? null} zoom={zoom} onClick={volverALaFoto} />
        )}

        {/* Columna "clas" del pliego: fila viva + historial + estadística.
            En móvil el wrapper es display:contents y cada bloque fluye con su
            `order` (la fila viva sobre el cupón; historial y estadística
            debajo); en el broadsheet es la columna izquierda real. */}
        <div className="prensa-area-clas">
          {/* "Primer" del pliego SOLO en el turno 1 (playing, sin intentos): ocupa
              la columna izquierda del broadsheet —que si no nace en blanco— con
              qué adivinar, intentos + zoom y la clave de color de las marcas de
              corrector. Se desmonta al primer intento (el historial toma el sitio).
              Oculto en móvil por CSS (.prensa-primer) para no empujar el fold. */}
          {dataReady && !ended && guesses.length === 0 && !pendingGuess && (
            <section className="prensa-primer" aria-label={t("prensa.primerLadillo")}>
              <div className="prensa-ladillo">{t("prensa.primerLadillo")}</div>
              <p className="primer-que">{t("prensa.primerQue")}</p>
              <p className="primer-sub">{t("cdd.introSub", { max: maxAttempts })}</p>
              <ul className="primer-clave" aria-label={t("prensa.primerClave")}>
                <li><i className="clave-ej bien">{t("prensa.claveBien")}</i></li>
                <li><i className="clave-ej cerca">{t("prensa.claveCerca")}</i></li>
                <li><i className="clave-ej mal">{t("prensa.claveMal")}</i></li>
              </ul>
            </section>
          )}

          {/* Último intento entre imagen y formulario. id=fila-viva: ancla del
              scroll post-envío del cupón (GuessForm). */}
          {dataReady && !ended && (pendingGuess || guesses.length > 0) && (
            <section
              id="fila-viva"
              aria-label={t("cdd.lastAttempt")}
              aria-live="polite"
              className="prensa-fila-viva flex flex-col gap-1"
            >
              <div className="prensa-ladillo">{t("cdd.lastAttempt")}</div>
              {pendingGuess ? (
                <AttemptRow g={pendingGuess} tolerance={tolerance} pending num={guesses.length + 1} />
              ) : (
                <AttemptRow
                  g={guesses[guesses.length - 1]}
                  tolerance={tolerance}
                  fresh={justRevealedIndex === guesses.length - 1}
                  num={guesses.length}
                />
              )}
            </section>
          )}

          {/* Intentos anteriores (más reciente primero lo ordena AttemptList). */}
          {olderGuesses.length > 0 && (
            <div className="prensa-historial">
              <AttemptList
                guesses={olderGuesses}
                pendingGuess={null}
                justRevealedIndex={ended ? justRevealedIndex : -1}
                tolerance={tolerance}
              />
            </div>
          )}

          {/* La estadística del día: SOLO con la edición cerrada (spec §3). */}
          {ended && daily.ready && (
            <aside className="prensa-estadistica flex flex-col gap-2">
              <div className="prensa-ladillo">{t("prensa.estadistica")}</div>
              <Distribution data={daily} attempts={attempts} won={won} />
            </aside>
          )}
        </div>

        <div className="prensa-area-jugar" ref={jugarRef}>
          {dataReady &&
            (!ended ? (
              <GuessForm
                onSubmit={submitGuess}
                isSubmitting={isSubmitting}
                guesses={guesses}
                tolerance={tolerance}
                attempts={attempts}
                maxAttempts={maxAttempts}
              />
            ) : (
              <button className="prensa-submit" onClick={() => setShowEnd(true)}>
                {t("cdd.viewResult")}
              </button>
            ))}
        </div>

        {/* Pie de página: enlaces en versalitas + reloj de cierre de edición. */}
        <footer className="prensa-area-pie prensa-cierre">
          <span>
            <button type="button" onClick={onOpenHowTo}>{t("cdd.helpAria")}</button>
            {" · "}
            <a href="/privacidad">{t("app.footerPrivacy")}</a>
          </span>
          <span>
            {t("prensa.cierre")} <span className="reloj">{countdown.formatted}</span>
          </span>
        </footer>
      </main>

      {/* Aviso one-time del rediseño (se auto-gatea por localStorage). */}
      <NotaRedaccion />

      {showEnd && ended && (
        <EndScreen
          won={won}
          car={car}
          guesses={guesses}
          max={maxAttempts}
          streak={streak}
          shareText={shareText}
          user={user}
          rank={rank}
          onOpenLogin={onOpenLogin}
          onOpenGarage={onOpenGarage}
          onOpenRanking={onOpenRanking}
          onClose={() => setShowEnd(false)}
        />
      )}
    </div>
  );
}
