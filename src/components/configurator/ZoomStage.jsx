// src/components/configurator/ZoomStage.jsx
// Escenario de la foto: marco 4:3 con HUD de cámara (crosshair, ZOOM%, INTENTO,
// grano). La foto la pinta CarImage en modo `configurator` (pipeline/seguridad
// intactos); aquí solo componemos el HUD.

import { useT } from "../../i18n";
import CarImage from "../CarImage";
import { Icon, I } from "./icons";

// Zoom MOSTRADO en el HUD por intento (1→5). Es decorativo: NO es el zoom CSS
// real (ese lo manda el juego, no se toca). Decreciente y SIEMPRE > 100% durante
// la partida, a propósito — el 100% es la imagen COMPLETA (el revelado), nunca un
// nivel de dificultad.
const ZOOM_DISPLAY = [350, 300, 250, 200, 150];

export default function ZoomStage({
  car,
  zoom,
  status,
  attempts,
  maxAttempts,
  hintIndex,
  totalHints,
  blurred = false,
  overlay = null,
  onRevealLoad,
}) {
  const { t } = useT();
  const revealed = status !== "playing";
  // Readout decorativo: 350/300/250/200/150 según el intento; nunca 100% en juego.
  const dispZoom = ZOOM_DISPLAY[Math.min(attempts, ZOOM_DISPLAY.length - 1)];
  const currentAttempt = Math.min(attempts + 1, maxAttempts);

  // HUD de cámara: crosshair, ZOOM% y un ÚNICO indicador de intento (texto). Se
  // quitaron los 5 puntos: parecían paginación de carrusel y duplicaban este texto.
  const hud = (
    <div className="cdd-hud">
      <div className="cdd-hud-tl">
        <Icon d={I.crosshair} size={26} />
      </div>
      <div className="cdd-hud-tr cdd-mono">
        {revealed ? t("cdd.revealed") : `${t("cdd.zoom")} ${dispZoom}%`}
      </div>
      <div className="cdd-hud-bl cdd-mono">
        {revealed ? "100%" : t("cdd.attemptHud", { n: currentAttempt, max: maxAttempts })}
      </div>
      {!revealed && <div className="cdd-grain" />}
    </div>
  );

  return (
    <div className={"cdd-stage" + (revealed ? " revealed" : "")}>
      <CarImage
        configurator
        hud={hud}
        src={car?.img ?? null}
        blurData={car?.blurData ?? null}
        zoom={zoom}
        hintIndex={hintIndex}
        totalHints={totalHints}
        status={status}
        showHintLabel={false}
        blurred={blurred}
        overlay={overlay}
        onRevealLoad={onRevealLoad}
      />
    </div>
  );
}
