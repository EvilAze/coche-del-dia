// src/components/configurator/StageHud.jsx
// HUD de cámara del escenario (crosshair, pips de intento, grano). Extraído de
// ZoomStage para reutilizarlo en la "Sala de pruebas" del admin (PreviewPanel),
// de modo que la previsualización muestre EXACTAMENTE el mismo chrome que ve el
// jugador. Decorativo: pointer-events off (lo aporta .cdd-hud en index.css).
//
// POR QUÉ PIPS y no texto (auditoría UX):
//   - El "INTENTO 3/5" iba suelto abajo-izquierda SIN scrim: sobre carrocerías
//     claras era ilegible — y es el dato de estado más importante de la pantalla.
//   - El "ZOOM 250%" era un readout decorativo hardcodeado que dejó de
//     corresponderse con la curva logarítmica real (y varía por coche vía
//     zoom_base): un dato falso vestido de telemetría, y jerga sin valor para
//     el jugador.
// Ahora todo el estado vive en UNA pill legible (la de arriba-derecha, que ya
// tenía fondo oscuro + blur): 5 pips (gastados/actual/restantes) + contador.
// Para lectores de pantalla, la pill expone el aria-label "INTENTO n/5".

import { useT } from "../../i18n";
import { Icon, I } from "./icons";

export default function StageHud({ revealed = false, attempts = 0, maxAttempts = 5 }) {
  const { t } = useT();
  const currentAttempt = Math.min(attempts + 1, maxAttempts);

  return (
    <div className="cdd-hud">
      <div className="cdd-hud-tl">
        <Icon d={I.crosshair} size={26} />
      </div>
      <div
        className="cdd-hud-tr cdd-mono"
        role="img"
        aria-label={revealed ? t("cdd.revealed") : t("cdd.attemptHud", { n: currentAttempt, max: maxAttempts })}
      >
        {revealed ? (
          t("cdd.revealed")
        ) : (
          <>
            {/* Pips: gastado (fallo previo) / actual (accent) / restante. */}
            <span className="cdd-pips" aria-hidden="true">
              {Array.from({ length: maxAttempts }, (_, i) => (
                <span
                  key={i}
                  className={"cdd-pip" + (i < attempts ? " spent" : i === attempts ? " now" : "")}
                />
              ))}
            </span>
            <span aria-hidden="true">{currentAttempt}/{maxAttempts}</span>
          </>
        )}
      </div>
      {!revealed && <div className="cdd-grain" />}
    </div>
  );
}
