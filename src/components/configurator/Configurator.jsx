// src/components/configurator/Configurator.jsx
// Pantalla de juego rediseñada ("configurador premium", dirección Platino).
// Ensambla header + intro + escenario (foto con HUD) + intentos + formulario o
// botón de resultado, y el revelado cinematográfico (EndScreen) como overlay.
// La lógica de juego vive en useGame (App) y llega por props.

import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { useCountdown } from "../../hooks/useCountdown";
import Header from "./Header";
import ZoomStage from "./ZoomStage";
import AttemptProgress from "./AttemptProgress";
import AttemptList, { AttemptRow } from "./AttemptList";
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

  // (PhotoPeek + IntersectionObserver retirados: el rediseño v0 es scroll natural
  // sin miniatura flotante.)

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
    // .prensa fija todas las variables del sistema; --accent se sigue
    // inyectando porque focus-ring y piezas .cdd-* lo consumen (rojo).
    <div className="cdd-app prensa" style={{ "--accent": DEFAULT_ACCENT }}>
      {/* El pliego: columna única en móvil (orden del DOM) y broadsheet de 3
          columnas ≥1100px vía grid-template-areas (.prensa-pliego). La columna
          "clas" agrupa fila viva + historial + estadística con display:contents
          en móvil (sus hijos fluyen sueltos con su propio `order`) y como
          bloque real en el pliego ancho. */}
      <main className="prensa-hoja prensa-pliego flex min-h-screen flex-col gap-5 safe-area-pad">
        <Header
          streak={streak}
          rank={rank}
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

        <ZoomStage
          car={car}
          zoom={zoom}
          status={status}
          hintIndex={hintIndex}
          totalHints={totalHints}
          blurred={status === "lost" && !user}
          onRevealLoad={onRevealLoad}
          progress={
            <AttemptProgress attempts={attempts} maxAttempts={maxAttempts} revealed={ended} />
          }
        />

        {/* Columna "clas" del pliego: fila viva + historial + estadística.
            En móvil el wrapper es display:contents y cada bloque fluye con su
            `order` (la fila viva sobre el cupón; historial y estadística
            debajo); en el broadsheet es la columna izquierda real. */}
        <div className="prensa-area-clas">
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

        <div className="prensa-area-jugar">
          {dataReady &&
            (!ended ? (
              <GuessForm
                onSubmit={submitGuess}
                isSubmitting={isSubmitting}
                guesses={guesses}
                tolerance={tolerance}
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

      {showEnd && ended && (
        <EndScreen
          won={won}
          car={car}
          guesses={guesses}
          max={maxAttempts}
          streak={streak}
          shareText={shareText}
          user={user}
          onOpenLogin={onOpenLogin}
          onOpenGarage={onOpenGarage}
          onClose={() => setShowEnd(false)}
        />
      )}
    </div>
  );
}
