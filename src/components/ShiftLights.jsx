// src/components/ShiftLights.jsx
// "Shift lights" de competición como indicador de intentos, en la ZONA DE
// ACCIÓN (entre la imagen y el formulario) para que la urgencia se VEA
// mientras juegas. Restantes iluminados por color (verde → ámbar → rojo según
// te acercas al límite); gastados en gris. El rojo solitario (último intento)
// parpadea = "última oportunidad". Verde/rojo ya son semánticos en el juego.

import { useT } from "../i18n";

export default function ShiftLights({ attempts = 0, maxAttempts = 5 }) {
  const { t } = useT();

  return (
    // Solo las luces (sin la palabra "INTENTOS"): un elemento visual distinto
    // de los labels de texto del formulario → no "choca" con "MARCA". Margen
    // asimétrico: pegado a la imagen arriba, con aire antes del formulario
    // abajo, para que se lea como parte del "guess zone" y no como cabecera
    // del formulario. El aria-label da el conteo accesible (la "?" lo explica).
    <div
      className="mb-6 mt-1 flex items-center justify-center gap-2"
      role="img"
      aria-label={t("app.attemptsRemainingAria", {
        count: Math.max(0, maxAttempts - attempts),
        max: maxAttempts,
      })}
    >
      {Array.from({ length: maxAttempts }).map((_, i) => {
        const spent = i < attempts;
        // Color por posición desde el final: último = rojo, penúltimo = ámbar,
        // resto = verde (escala el caso veterano de 1 intento).
        const fromEnd = maxAttempts - 1 - i;
        const tone = fromEnd === 0 ? "red" : fromEnd === 1 ? "amber" : "green";
        const lastChance =
          !spent && tone === "red" && maxAttempts - attempts === 1;

        let cls = "bg-white/15"; // gastado (apagado)
        let glow;
        if (!spent) {
          if (tone === "red") {
            cls = "bg-red-500";
            glow = "0 0 7px rgba(239,68,68,0.65)";
          } else if (tone === "amber") {
            cls = "bg-amber-400";
            glow = "0 0 7px rgba(251,191,36,0.6)";
          } else {
            cls = "bg-green-400";
            glow = "0 0 6px rgba(74,222,128,0.55)";
          }
        }
        return (
          <span
            key={i}
            aria-hidden="true"
            className={`h-2.5 w-2.5 rounded-full transition-colors duration-300 ${cls} ${
              lastChance ? "motion-safe:animate-pulse" : ""
            }`}
            style={glow ? { boxShadow: glow } : undefined}
          />
        );
      })}
    </div>
  );
}
