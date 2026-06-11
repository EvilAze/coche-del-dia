// src/components/configurator/Configurator.jsx
// Pantalla de juego rediseñada ("configurador premium", dirección Platino).
// Ensambla header + intro + escenario (foto con HUD) + intentos + formulario o
// botón de resultado, y el revelado cinematográfico (EndScreen) como overlay.
// La lógica de juego vive en useGame (App) y llega por props.

import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import Header from "./Header";
import { Icon, I } from "./icons";
import ZoomStage from "./ZoomStage";
import AttemptList, { AttemptRow } from "./AttemptList";
import GuessForm from "./GuessForm";
import EndScreen from "./EndScreen";
import PhotoPeek from "./PhotoPeek";

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
  const { t, locale } = useT();
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

  // Conector del H1 según idioma ("marca, modelo y/and año").
  const conn = locale === "es" ? "y" : "and";

  // PhotoPeek (auditoría UX #7): cuando el escenario sale del viewport durante
  // la partida (auto-scroll al enfocar un campo + teclado en móvil, o scroll
  // manual al historial), una miniatura flotante mantiene la foto a un vistazo
  // — elegir marca/modelo sin verla es jugar a ciegas. Observamos GEOMETRÍA
  // (IntersectionObserver), no foco: así también cubre el scroll manual y se
  // apaga sola si el teclado se cierra y la foto vuelve a verse.
  const stageColRef = useRef(null);
  const [stageOffscreen, setStageOffscreen] = useState(false);
  useEffect(() => {
    const el = stageColRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      // < 0.15 y no === 0: con un 15% visible la foto ya no sirve para
      // comparar; el umbral intermedio evita parpadeo en el borde justo.
      ([entry]) => setStageOffscreen(entry.intersectionRatio < 0.15),
      { threshold: [0, 0.15, 0.3] }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Tap en la miniatura: cerrar teclado (blur) y volver al escenario. El blur
  // va primero — con el teclado abierto el viewport visual está encogido y el
  // scroll calcularía mal el destino.
  const scrollBackToStage = () => {
    document.activeElement?.blur?.();
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    stageColRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  };

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
        <div className={"cdd-fold" + (ended ? " is-ended" : "")}>
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
            <h1 className="cdd-h1">
              {t("cdd.guess")} <em>{t("cdd.wordMarca")}</em>, <em>{t("cdd.wordModelo")}</em> {conn}{" "}
              <em>{t("cdd.wordAnio")}</em>
            </h1>
            {/* "?" de ayuda junto al H1 (no en la barra: allí saturaba en móvil).
                Contextualmente es su sitio — la duda "¿cómo se juega?" nace justo
                donde se resume la regla. `howtoPulse` (primera visita) le da un
                latido sutil que invita al novato sin modal forzado. */}
            <button
              type="button"
              className={"cdd-helpbtn" + (howtoPulse ? " pulse" : "")}
              aria-label={t("cdd.helpAria")}
              title={t("cdd.helpAria")}
              onClick={onOpenHowTo}
            >
              <Icon d={I.help} size={17} />
            </button>
          </div>

          <div className="cdd-main">
            <div className="cdd-col cdd-col-stage" ref={stageColRef}>
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
                  siempre visible. El historial COMPLETO no va aquí (inflaría la
                  columna y encogería la foto; vive bajo el fold, ver abajo) —
                  pero SÍ va la "fila viva" del último intento: sin ella, el
                  shimmer de pending y el flip-reveal ocurrían fuera de pantalla
                  y el jugador pulsaba Adivinar sin ver feedback ninguno. Una
                  fila (~46px) es el coste justo en alto de foto. Se duplica a
                  propósito en el historial de abajo: esto es el "estado vivo",
                  aquello el registro completo. */}
              {dataReady && !ended && (pendingGuess || guesses.length > 0) && (
                <div className="cdd-live-attempt" aria-live="polite">
                  {pendingGuess ? (
                    <AttemptRow
                      g={pendingGuess}
                      index={guesses.length}
                      tolerance={tolerance}
                      pending
                    />
                  ) : (
                    <AttemptRow
                      g={guesses[guesses.length - 1]}
                      index={guesses.length - 1}
                      tolerance={tolerance}
                      fresh={justRevealedIndex === guesses.length - 1}
                    />
                  )}
                </div>
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

      {/* Miniatura flotante: solo en partida (al revelar, la foto ya no es un
          secreto que custodiar ni una referencia que necesitar). */}
      {dataReady && !ended && stageOffscreen && (
        <PhotoPeek src={car?.img} zoom={zoom} onClick={scrollBackToStage} />
      )}

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
