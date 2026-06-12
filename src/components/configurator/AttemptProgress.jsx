// src/components/configurator/AttemptProgress.jsx
// Barra de progreso de intentos, BAJO la imagen. Antes eran pips SOBRE la foto
// que pintaban en ROJO los intentos GASTADOS — un "sello de fracaso" sobre la
// protagonista de la pantalla. Aquí invertimos la lógica: encendemos los intentos
// RESTANTES (menta = disponible), viramos a ámbar cuando quedan 2 y a rojo
// pulsante en el último (urgencia real, no castigo retroactivo). Un único tono por
// urgencia: lo dicta CUÁNTOS quedan, no en qué casilla estás. Al revelar el coche
// no se pinta: ya no hay intentos que contar.

import { useT } from "../../i18n";

export default function AttemptProgress({ attempts = 0, maxAttempts = 5, revealed = false }) {
  const { t } = useT();
  // Sin partida activa no hay barra: al revelar el coche el dato sobra.
  if (revealed || maxAttempts <= 0) return null;

  const remaining = Math.max(0, maxAttempts - attempts);
  const tone = remaining <= 1 ? "danger" : remaining === 2 ? "warn" : "ok";
  // Plural a mano (el i18n del proyecto solo interpola {var}, no declina): "1
  // restante" vs "N restantes". La mayúscula la pone el CSS (text-transform).
  const label =
    remaining === 1 ? t("cdd.attemptsLeftOne") : t("cdd.attemptsLeftMany", { count: remaining });

  return (
    <div
      className={"cdd-progress tone-" + tone}
      role="img"
      // Reutilizamos el aria ya existente ("{count} de {max} intentos restantes").
      aria-label={t("app.attemptsRemainingAria", { count: remaining, max: maxAttempts })}
    >
      <span className="cdd-progress-track" aria-hidden="true">
        {Array.from({ length: maxAttempts }, (_, i) => (
          <span key={i} className={"cdd-progress-seg" + (i < attempts ? " spent" : "")} />
        ))}
      </span>
      <span className="cdd-progress-label cdd-mono" aria-hidden="true">
        {label}
      </span>
    </div>
  );
}
