// src/components/AttemptDots.jsx
// Indicador de intentos del juego principal: puntos discretos en un "chip"
// anclado a la esquina inferior-derecha de la imagen. Comparte el lenguaje
// visual del resto de controles sobre la foto (borde + fondo translúcido +
// blur, igual que el botón de ampliar) para quedar integrado, no pegado.
//
// Los intentos GASTADOS quedan apagados; los que QUEDAN se iluminan en el oro
// de marca y viran a ámbar (quedan 2) y rojo que late (último intento). Un solo
// color por urgencia, sin arcoíris fijo por posición.

import { useT } from "../i18n";

export default function AttemptDots({ attempts = 0, maxAttempts = 5 }) {
  const { t } = useT();
  const remaining = Math.max(0, maxAttempts - attempts);

  const tone = remaining <= 1 ? "red" : remaining === 2 ? "amber" : "accent";
  const litBg =
    tone === "red" ? "bg-red-500" : tone === "amber" ? "bg-amber-400" : "bg-accent";
  const litGlow =
    tone === "red"
      ? "0 0 5px rgba(239,68,68,0.6)"
      : tone === "amber"
        ? "0 0 5px rgba(245,158,11,0.5)"
        : "0 0 5px rgba(232,200,122,0.5)";

  return (
    <div
      className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-2.5 py-1.5 backdrop-blur-sm"
      role="img"
      aria-label={t("app.attemptsRemainingAria", {
        count: remaining,
        max: maxAttempts,
      })}
    >
      {Array.from({ length: maxAttempts }).map((_, i) => {
        const spent = i < attempts;
        const lastChance = !spent && remaining === 1;
        return (
          <span
            key={i}
            aria-hidden="true"
            className={`h-2 w-2 rounded-full transition-colors duration-300 ${
              spent ? "bg-white/20" : litBg
            } ${lastChance ? "motion-safe:animate-pulse" : ""}`}
            style={spent ? undefined : { boxShadow: litGlow }}
          />
        );
      })}
    </div>
  );
}
