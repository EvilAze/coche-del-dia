// src/components/configurator/StageHud.jsx
// Atrezzo de "cámara" del escenario: crosshair (esquina) + grano de sensor. El
// contador de intentos YA NO vive aquí — se movió a una barra BAJO la imagen
// (AttemptProgress). Sobre la foto, los pips de intento gastado iban en rojo y
// estampaban "fracaso" sobre la protagonista; fuera de ella se leen mejor y sin
// ese peso negativo. Aquí solo queda el chrome decorativo, que se comparte con la
// "Sala de pruebas" del admin (PreviewPanel) para que la previsualización del
// recorte sea idéntica a la del jugador. Decorativo: pointer-events off (lo aporta
// .cdd-hud en index.css). El grano se apaga al revelar (la foto limpia es el premio
// y ya no hay "REVELADO" que rotular: el coche entero lo dice todo).

import { Icon, I } from "./icons";

export default function StageHud({ revealed = false }) {
  return (
    <div className="cdd-hud">
      <div className="cdd-hud-tl">
        <Icon d={I.crosshair} size={26} />
      </div>
      {!revealed && <div className="cdd-grain" />}
    </div>
  );
}
