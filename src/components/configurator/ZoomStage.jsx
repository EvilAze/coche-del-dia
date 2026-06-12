// src/components/configurator/ZoomStage.jsx
// Escenario de la foto: marco cuadrado con HUD de cámara (crosshair + grano). La
// foto la pinta CarImage en modo `configurator` (pipeline/seguridad intactos); el
// HUD vive en StageHud (compartido con la "Sala de pruebas" del admin para que la
// previsualización sea fiel). El contador de intentos (`progress`, AttemptProgress)
// va anclado al BORDE INFERIOR de la imagen, dentro del marco: lo monta Configurator
// y lo reenviamos a CarImage como `bottomBar`.

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
  progress = null,
  onRevealLoad,
}) {
  const revealed = status !== "playing";

  return (
    <div className={"cdd-stage" + (revealed ? " revealed" : "")}>
      <CarImage
        configurator
        hud={<StageHud revealed={revealed} />}
        bottomBar={progress}
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
