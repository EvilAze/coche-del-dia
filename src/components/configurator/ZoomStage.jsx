// src/components/configurator/ZoomStage.jsx
// Escenario de la foto: marco cuadrado con HUD de cámara (crosshair + grano). La
// foto la pinta CarImage en modo `configurator` (pipeline/seguridad intactos); el
// HUD vive en StageHud (compartido con la "Sala de pruebas" del admin para que la
// previsualización sea fiel). El contador de intentos (`progress`, AttemptProgress)
// va anclado al BORDE INFERIOR de la imagen, dentro del marco: lo monta Configurator
// y lo reenviamos a CarImage como `bottomBar`.

import CarImage from "../CarImage";

export default function ZoomStage({
  car,
  zoom,
  status,
  hintIndex,
  totalHints,
  blurred = false,
  // Desenfoque de juego del Túnel de viento (px CSS): CarImage lo compone
  // sobre la imagen ya horneada por el servidor. 0 en el juego diario.
  blurPx = 0,
  overlay = null,
  progress = null,
  onRevealLoad,
}) {
  const revealed = status !== "playing";

  return (
    <section className="flex flex-col gap-3">
      <div className={"cdd-stage" + (revealed ? " revealed" : "")}>
        <CarImage
          configurator
          src={car?.img ?? null}
          blurData={car?.blurData ?? null}
          zoom={zoom}
          blurPx={blurPx}
          hintIndex={hintIndex}
          totalHints={totalHints}
          status={status}
          showHintLabel={false}
          blurred={blurred}
          overlay={overlay}
          onRevealLoad={onRevealLoad}
        />
      </div>
      {/* Dots de progreso DEBAJO de la imagen (calcado del car-image.tsx de v0). */}
      {progress}
    </section>
  );
}
