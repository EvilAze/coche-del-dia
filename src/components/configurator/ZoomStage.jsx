// src/components/configurator/ZoomStage.jsx
// Escenario de la foto: marco 4:3 con HUD de cámara (crosshair, ZOOM%, INTENTO,
// puntos de intentos restantes y grano). La foto la pinta CarImage en modo
// `configurator` (pipeline/seguridad intactos); aquí solo componemos el HUD.

import { useT } from "../../i18n";
import CarImage from "../CarImage";
import { Icon, I } from "./icons";

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
  const attemptsLeft = maxAttempts - attempts;
  const zoomPct = Math.round((revealed ? 1 : zoom) * 100);
  const currentAttempt = Math.min(attempts + 1, maxAttempts);

  const hud = (
    <div className="cdd-hud">
      <div className="cdd-hud-tl">
        <Icon d={I.crosshair} size={26} />
      </div>
      <div className="cdd-hud-tr cdd-mono">
        {revealed ? t("cdd.revealed") : `${t("cdd.zoom")} ${zoomPct}%`}
      </div>
      <div className="cdd-hud-bl cdd-mono">
        {revealed ? "100%" : `· ${t("cdd.attemptHud", { n: currentAttempt, max: maxAttempts })}`}
      </div>
      <div className="cdd-hud-br">
        {Array.from({ length: maxAttempts }).map((_, i) => (
          <span key={i} className={"cdd-dot" + (i < attemptsLeft ? " on" : "")} />
        ))}
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
