// src/components/configurator/ZoomStage.jsx
// Escenario de la foto: marco cuadrado con HUD de cámara (crosshair + grano). La
// foto la pinta CarImage en modo `configurator` (pipeline/seguridad intactos); el
// HUD vive en StageHud (compartido con la "Sala de pruebas" del admin para que la
// previsualización sea fiel). El contador de intentos NO va sobre la foto: vive en
// AttemptProgress, bajo la imagen (lo monta Configurator).

import CarImage from "../CarImage";
import StageHud from "./StageHud";

export default function ZoomStage({
  car,
  zoom,
  status,
  hintIndex,
  totalHints,
  blurred = false,
  overlay = null,
  onRevealLoad,
}) {
  const revealed = status !== "playing";

  return (
    <div className={"cdd-stage" + (revealed ? " revealed" : "")}>
      <CarImage
        configurator
        hud={<StageHud revealed={revealed} />}
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
