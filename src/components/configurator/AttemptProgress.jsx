// src/components/configurator/AttemptProgress.jsx
// Pips de intentos «Prensa del motor»: cuadraditos de negativo fotográfico en
// el pie de foto (los monta ZoomStage junto al pie en cursiva). Gastado =
// tinta sólida; actual = rojo; restante = marco vacío. La urgencia del ÚLTIMO
// intento parpadea en rojo — único momento en que el pie reclama atención
// (reduced-motion lo anula en CSS). El conteo exacto va solo al aria-label.
// Al revelar el coche no se pinta: ya no hay intentos que contar.

import { useT } from "../../i18n";

export default function AttemptProgress({ attempts = 0, maxAttempts = 5, revealed = false }) {
  const { t } = useT();
  if (revealed || maxAttempts <= 0) return null;

  const remaining = Math.max(0, maxAttempts - attempts);
  const lastTry = remaining === 1;

  return (
    <span
      className="prensa-pips"
      role="img"
      aria-label={t("app.attemptsRemainingAria", { count: remaining, max: maxAttempts })}
    >
      {Array.from({ length: maxAttempts }, (_, i) => (
        <span
          key={i}
          className={
            "pip " +
            (i < attempts
              ? "gastado"
              : i === attempts
                ? "actual" + (lastTry ? " peligro" : "")
                : "")
          }
        />
      ))}
    </span>
  );
}
