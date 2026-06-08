// src/components/configurator/Configurator.jsx
// Pantalla de juego rediseñada ("configurador premium", dirección Platino).
// Ensambla header + intro + escenario (foto con HUD) + intentos + formulario o
// botón de resultado, y el revelado cinematográfico (EndScreen) como overlay.
// La lógica de juego vive en useGame (App) y llega por props.

import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import Header from "./Header";
import ZoomStage from "./ZoomStage";
import AttemptList from "./AttemptList";
import GuessForm from "./GuessForm";
import EndScreen from "./EndScreen";

// Dirección visual por defecto: Platino Eléctrico con acento menta (#7af0c8).
const DEFAULT_THEME = "platino";
const DEFAULT_ACCENT = "#7af0c8";

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
  const { t, locale, dateLocale } = useT();
  const ended = status !== "playing";
  const won = status === "won";

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

  const dateLabel = new Date()
    .toLocaleDateString(dateLocale, { weekday: "long", day: "numeric", month: "long" })
    .toUpperCase();
  const conn = locale === "es" ? "y" : "and";

  return (
    <div className={"cdd-app theme-" + theme} style={{ "--accent": accent }}>
      <div className="cdd-ambient" />
      <div className="cdd-shell">
        {/* El "fold": cabecera + intro + escenario + formulario ocupan el
            viewport (100svh en móvil, vía .cdd-fold en index.css). El escenario
            usa flex:1 y absorbe TODO el alto libre, así la foto es lo más grande
            posible y el CTA «Adivinar» queda completo sin scroll. El historial de
            intentos (dentro del panel) y el pie fluyen justo debajo del fold.
            En desktop .cdd-fold es un contenedor neutro: manda el grid de dos
            columnas (ver @media min-width:1000px). */}
        <div className="cdd-fold">
          <Header
            streak={streak}
            user={user}
            repescaAlert={repescaAlert}
            onOpenProfile={onOpenProfile}
            onOpenLogin={onOpenLogin}
            onOpenRanking={onOpenRanking}
            onOpenGarage={onOpenGarage}
          />

          <div className="cdd-intro">
            {/* Meta-row: fecha (con barrita de acento, vía CSS) a la izquierda y
                el "?" de ayuda realineado a la derecha. */}
            <div className="cdd-metarow">
              <span className="cdd-date cdd-mono">{dateLabel}</span>
              {onOpenHowTo && (
                <button
                  type="button"
                  onClick={onOpenHowTo}
                  aria-label={t("cdd.helpAria")}
                  title={t("cdd.helpAria")}
                  className={"cdd-iconbtn" + (howtoPulse ? " cdd-help-pulse" : "")}
                  style={{ height: 24, minWidth: 24, padding: 0, borderRadius: 8 }}
                >
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>?</span>
                </button>
              )}
            </div>
            <h1 className="cdd-h1">
              {t("cdd.guess")} <em>{t("cdd.wordMarca")}</em>, <em>{t("cdd.wordModelo")}</em> {conn}{" "}
              <em>{t("cdd.wordAnio")}</em>
            </h1>
            <p className="cdd-sub">{t("cdd.introSub", { max: maxAttempts })}</p>
          </div>

          <div className="cdd-main">
            <div className="cdd-col cdd-col-stage">
              <ZoomStage
                car={car}
                zoom={zoom}
                status={status}
                attempts={attempts}
                maxAttempts={maxAttempts}
                hintIndex={hintIndex}
                totalHints={totalHints}
                blurred={status === "lost" && !user}
                onRevealLoad={onRevealLoad}
              />
            </div>

            <div className="cdd-col cdd-col-panel">
              {/* Zona de acción ANCLADA al fondo del fold: el formulario (o el
                  botón de resultado) cierra el viewport, así «Adivinar» queda
                  siempre visible. El historial de intentos NO va aquí: dentro del
                  fold inflaría la columna y encogería la foto hasta su mínimo.
                  Vive bajo el fold (ver abajo). */}
              {dataReady &&
                (!ended ? (
                  <GuessForm
                    onSubmit={submitGuess}
                    isSubmitting={isSubmitting}
                    guesses={guesses}
                    tolerance={tolerance}
                  />
                ) : (
                  <button className="cdd-submit" onClick={() => setShowEnd(true)}>
                    {/* Etiqueta neutra: re-abre el panel de resultado/compartir. No
                        dice "VER REVELADO" porque el coche ya está revelado en el
                        escenario; sirve igual para ganar, perder y respuesta bloqueada. */}
                    <span>{t("cdd.viewResult")}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>

        {/* Historial de intentos: FUERA del fold a propósito. Así no compite por
            el alto con la foto (que llena el viewport) y «Adivinar» cae al fondo;
            los intentos quedan fuera de pantalla hasta hacer scroll. Más-reciente-
            primero (lo ordena AttemptList). En desktop se realinea bajo la columna
            del formulario vía CSS. */}
        <AttemptList
          guesses={guesses}
          pendingGuess={pendingGuess}
          justRevealedIndex={justRevealedIndex}
          tolerance={tolerance}
        />

        <footer className="cdd-footer cdd-mono">
          <a className="cdd-foot-link" href="/privacidad">{t("app.footerPrivacy")}</a>
          <span>© {new Date().getFullYear()} · {t("app.title")}</span>
        </footer>
      </div>

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
          onClose={() => setShowEnd(false)}
        />
      )}
    </div>
  );
}
