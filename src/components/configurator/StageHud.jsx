// src/components/configurator/StageHud.jsx
// HUD de cámara del escenario (crosshair, ZOOM%, INTENTO, grano). Extraído de
// ZoomStage para reutilizarlo en la "Sala de pruebas" del admin (PreviewPanel),
// de modo que la previsualización muestre EXACTAMENTE el mismo chrome que ve el
// jugador. Decorativo: pointer-events off (lo aporta .cdd-hud en index.css).

import { useT } from "../../i18n";
import { Icon, I } from "./icons";

// Zoom MOSTRADO en el HUD por intento (1→5). Es decorativo: NO es el zoom CSS
// real (ese lo manda el juego). Decreciente y SIEMPRE > 100% durante la partida,
// a propósito — el 100% es la imagen COMPLETA (el revelado), nunca dificultad.
export const ZOOM_DISPLAY = [350, 300, 250, 200, 150];

export default function StageHud({ revealed = false, attempts = 0, maxAttempts = 5 }) {
  const { t } = useT();
  // Readout decorativo: 350/300/250/200/150 según el intento; nunca 100% en juego.
  const dispZoom = ZOOM_DISPLAY[Math.min(attempts, ZOOM_DISPLAY.length - 1)];
  const currentAttempt = Math.min(attempts + 1, maxAttempts);

  return (
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
}
