// src/components/configurator/Configurator.jsx
// Pantalla de juego rediseñada ("configurador premium", dirección Platino).
// Ensambla header + intro + escenario (foto con HUD) + intentos + formulario o
// botón de resultado, y el revelado cinematográfico (EndScreen) como overlay.
// La lógica de juego vive en useGame (App) y llega por props.

import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { useCountdown } from "../../hooks/useCountdown";
import { useEncajeEscenario } from "../../hooks/useEncajeEscenario";
import { esApp } from "../../lib/plataforma";
import Header from "./Header";
import EdicionNoDisponible from "./EdicionNoDisponible";
import ZoomStage from "./ZoomStage";
import PhotoPeek from "./PhotoPeek";
import AttemptList from "./AttemptList";

import GuessForm from "./GuessForm";
import EndScreen from "./EndScreen";
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
  // Logueado sin firma: el EndScreen se la ofrece al ganar (ver App.jsx).
  necesitaNick = false,
  onOpenNickname,
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
  // EN LA APP NO SE ENCAJA POR JS. El pliego monta un shell fijo (ver «EL PLIEGO
  // SIN SCROLL» en index.css) donde la foto ya se dimensiona por ALTO con flex +
  // aspect-ratio, de forma continua y sin medir nada. Dejar además este hook
  // activo sería poner dos mecanismos a discutir por la geometría del MISMO
  // elemento —el que gobierna las reglas 5 y 7—, que es exactamente el escenario
  // del que salió la foto servida como miniatura de 24px que documenta el hook.
  // Un solo dueño del ancho del marco por plataforma: CSS en la app, este hook
  // en la web.
  const enApp = esApp();
  const anchoEscenario = useEncajeEscenario({
    fotoRef,
    jugarRef,
    hojaRef,
    activo: !enApp && dataReady && !ended && guesses.length === 0 && !pendingGuess,
  });

  // Tap en el recorte: cerrar el teclado y devolver el escenario al viewport.
  function volverALaFoto() {
    document.activeElement?.blur?.();
    fotoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // (Aquí se calculaba `olderGuesses`, que le quitaba al historial el intento
  // que ya pintaba la fila viva. Sin fila viva no hay nada que descontar: el
  // historial recibe `guesses` entero.)

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
        // `escenario-encajado` es lo que ACTIVA el cap del escenario: sin clase
        // que lo marque, el cap se declararía siempre y no habría forma de
        // distinguir "hay que encoger la foto" de "cabe entera". (Nació además
        // para ganarle en especificidad a la regla de la foto a sangre, que
        // declaraba `max-width: none`; esa regla ya no existe.)
        // `app-pantalla` enciende el shell fijo de la app (una pantalla, sin
        // scroll). Solo DURANTE la partida: al terminar, el revelado recupera
        // su proporción natural y entran la estadística y la distribución, así
        // que ahí el pliego vuelve a ser un documento que se lee bajando —
        // igual que en web. La clase se pinta siempre; quien la activa es el
        // `data-plataforma="app"` de <html>, así que en web es inerte.
        className={
          "prensa-hoja prensa-pliego flex min-h-screen flex-col gap-3" +
          (anchoEscenario && !ended ? " escenario-encajado" : "") +
          (!ended ? " app-pantalla" : "")
        }
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
          onOpenHowTo={onOpenHowTo}
        />

        {/* H1 real solo para lectores de pantalla/SEO (v0 no lo pinta). */}
        <h1 className="sr-only">
          {t("cdd.guess")} {t("cdd.wordMarca")}, {t("cdd.wordModelo")} {conn}{" "}
          {t("cdd.wordAnio")}
        </h1>

        {loadError ? (
          <EdicionNoDisponible onRetry={onRetryLoad} isRetrying={isRetryingLoad} />
        ) : (
          // Aquí iba `blurred={status === "lost" && !user}`: al anónimo que
          // perdía se le emborronaba el coche hasta que iniciara sesión. El
          // muro se retiró entero —ver «Política de revelado» en
          // api/validate-guess.js— y con él la prop.
          <ZoomStage
            car={car}
            zoom={zoom}
            status={status}
            hintIndex={hintIndex}
            totalHints={totalHints}
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
          {/* El historial completo. Ya no se le quita el último intento (no hay
              fila viva que lo muestre aparte) y TAMPOCO se oculta en móvil
              durante la partida, como hizo un tiempo: al retirarse el veredicto
              estampado sobre los campos —el valor tachado, la bandera del «mismo
              país», la flecha del año— el historial volvió a ser el único sitio
              donde vive el acuse de recibo de cada intento. Se pinta siempre que
              haya algo que recapitular. */}
          {guesses.length > 0 && (
            <div className="prensa-historial">
              <AttemptList
                guesses={guesses}
                pendingGuess={null}
                justRevealedIndex={justRevealedIndex}
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

        {/* Pie de página: el reloj de cierre y, debajo, los enlaces de servicio.
            La columna centrada la pone `.prensa-cierre` en CSS —no utilidades
            aquí—: las reglas propias van después de @tailwind utilities y a
            igual especificidad ganaban ellas, así que el `items-center` escrito
            en el JSX no llegaba a aplicarse nunca. */}
        <footer className="prensa-area-pie prensa-cierre py-6">
          <div className="text-xs font-bold uppercase text-tinta tabular-nums tracking-wider">
            <span className="text-rojo mr-2">{t("prensa.cierre")}</span>
            {countdown.formatted}
          </div>
          {/* Los enlaces de servicio. En la app se ocultan (CSS): con el shell
              fijo el pie no se alcanza, y sus dos entradas viven en el sumario
              de la cabecera — «Cómo se juega» ya estaba allí y la privacidad se
              añadió por esto. El reloj de cierre sí se queda: es una línea y es
              información del día, no navegación. */}
          <div className="prensa-cierre-enlaces flex justify-center items-center gap-x-3 text-xs text-muted font-bold uppercase">
            {/* Primera visita (`howtoPulse`): las reglas se pintan en rojo, que
                es el color de "atención" del sistema. Es el único empujón que le
                queda al recién llegado desde que el pliego dejó de abrir con la
                sección de «qué adivinar»; en cuanto abre el modal una vez, el
                enlace vuelve a tinta apagada y no molesta más. */}
            <button
              type="button"
              onClick={onOpenHowTo}
              className={"transition-colors " + (howtoPulse ? "text-rojo" : "hover:text-rojo")}
            >
              {t("cdd.helpAria")}
            </button>
            <span>·</span>
            <a href="/privacidad" className="hover:text-rojo transition-colors">{t("app.footerPrivacy")}</a>
          </div>
        </footer>
      </main>

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
          necesitaNick={necesitaNick}
          onOpenNickname={onOpenNickname}
          onOpenLogin={onOpenLogin}
          onOpenGarage={onOpenGarage}
          onOpenRanking={onOpenRanking}
          onClose={() => setShowEnd(false)}
        />
      )}
    </div>
  );
}
