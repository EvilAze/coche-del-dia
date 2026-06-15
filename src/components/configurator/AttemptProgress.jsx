// src/components/configurator/AttemptProgress.jsx
// Barra de progreso de intentos, BAJO la imagen. Antes eran pips SOBRE la foto que
// pintaban en ROJO los gastados ("sello de fracaso" sobre la protagonista). Aquí
// encendemos los RESTANTES y dejamos que el COLOR sea el único canal: menta =
// disponible, ámbar a 2, rojo pulsante en el último (urgencia real, no castigo
// retroactivo). SIN texto ni etiqueta visible: la barra debe ser discreta y no
// robarle protagonismo a la foto; el conteo exacto va solo al aria-label (lectores
// de pantalla). Al revelar el coche no se pinta: ya no hay intentos que contar.

import { useT } from "../../i18n";

export default function AttemptProgress({ attempts = 0, maxAttempts = 5, revealed = false }) {
  const { t } = useT();
  // Sin partida activa no hay barra: al revelar el coche el dato sobra.
  if (revealed || maxAttempts <= 0) return null;

  const remaining = Math.max(0, maxAttempts - attempts);
  const tone = remaining <= 1 ? "danger" : remaining === 2 ? "warn" : "ok";

  return (
    <div
      className={"cdd-progress tone-" + tone}
      role="img"
      // El conteo exacto vive SOLO aquí (no hay etiqueta visible): reutilizamos el
      // aria ya existente ("{count} de {max} intentos restantes").
      aria-label={t("app.attemptsRemainingAria", { count: remaining, max: maxAttempts })}
    >
      <span className="cdd-progress-track" aria-hidden="true">
        {Array.from({ length: maxAttempts }, (_, i) => {
          const cls =
            i < attempts ? "cdd-progress-seg spent"
            : i === attempts ? "cdd-progress-seg current"
            : "cdd-progress-seg";
          return <span key={i} className={cls} />;
        })}
      </span>
    </div>
  );
}
