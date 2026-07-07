// src/components/configurator/Configurator.jsx
// Pantalla de juego rediseñada ("configurador premium", dirección Platino).
// Ensambla header + intro + escenario (foto con HUD) + intentos + formulario o
// botón de resultado, y el revelado cinematográfico (EndScreen) como overlay.
// La lógica de juego vive en useGame (App) y llega por props.

import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import Header from "./Header";
import ZoomStage from "./ZoomStage";
import AttemptProgress from "./AttemptProgress";
import AttemptList, { AttemptRow } from "./AttemptList";
import GuessForm from "./GuessForm";
import EndScreen from "./EndScreen";

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

  return (
    // .prensa fija todas las variables del sistema; --accent se sigue
    // inyectando porque focus-ring y piezas .cdd-* lo consumen (rojo).
    <div className="cdd-app prensa" style={{ "--accent": DEFAULT_ACCENT }}>
      {/* Contenedor calcado de car-guess-game.tsx (v0): columna única centrada,
          max-w-md, gap-6, scroll natural. Fuera el "fold"/PhotoPeek/2-columnas. */}
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-4 safe-area-pad">
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

        {/* Último intento entre imagen y formulario (calcado del v0). */}
        {dataReady && !ended && (pendingGuess || guesses.length > 0) && (
          <section aria-label={t("cdd.lastAttempt")} aria-live="polite" className="flex flex-col gap-1">
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

        {dataReady &&
          (!ended ? (
            <GuessForm
              onSubmit={submitGuess}
              isSubmitting={isSubmitting}
              guesses={guesses}
              tolerance={tolerance}
            />
          ) : (
            <button
              className="btn btn--mint h-12 w-full rounded-xl"
              onClick={() => setShowEnd(true)}
            >
              {t("cdd.viewResult")}
            </button>
          ))}

        {/* Intentos anteriores (más reciente primero lo ordena AttemptList). */}
        {olderGuesses.length > 0 && (
          <AttemptList
            guesses={olderGuesses}
            pendingGuess={null}
            justRevealedIndex={ended ? justRevealedIndex : -1}
            tolerance={tolerance}
          />
        )}

        {/* Footer en 3 columnas iguales: el © queda perfectamente centrado en el
            medio (no depende del ancho de los enlaces laterales). */}
        <footer className="mt-2 grid grid-cols-3 items-center gap-2 text-[11px] text-muted-foreground">
          <button
            type="button"
            className="justify-self-start text-left transition-colors hover:text-foreground"
            onClick={onOpenHowTo}
          >
            {t("cdd.helpAria")}
          </button>
          <span className="justify-self-center whitespace-nowrap text-center">
            © {new Date().getFullYear()} · {t("app.title")}
          </span>
          <a
            className="justify-self-end text-right transition-colors hover:text-foreground"
            href="/privacidad"
          >
            {t("app.footerPrivacy")}
          </a>
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
