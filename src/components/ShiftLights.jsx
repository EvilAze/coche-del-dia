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
    // Solo las luces (sin la palabra "INTENTOS"): viven en la repisa del marco
    // (la coloca CarImage), no sobre la foto, así que no necesitan pastilla ni
    // fondo. aria-label da el conteo accesible.
    <div
      className="flex items-center gap-2"
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
          // Mismos tonos, pero más apagados (shade 500 + glow tenue) para que
          // no resalten en exceso sobre la imagen.
          if (tone === "red") {
            cls = "bg-red-500/90";
            glow = "0 0 4px rgba(239,68,68,0.4)";
          } else if (tone === "amber") {
            cls = "bg-amber-500/90";
            glow = "0 0 4px rgba(245,158,11,0.35)";
          } else {
            cls = "bg-green-500/90";
            glow = "0 0 4px rgba(34,197,94,0.3)";
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
