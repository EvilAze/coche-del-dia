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

  // Dots calcados del car-image.tsx de v0: gastado = barra ancha (foreground/70),
  // actual = barra menta con glow, restante = punto pequeño (muted/30). Centrados.
  return (
    <div
      className="flex items-center justify-center gap-2"
      role="img"
      aria-label={t("app.attemptsRemainingAria", { count: remaining, max: maxAttempts })}
    >
      {Array.from({ length: maxAttempts }, (_, i) => (
        <span
          key={i}
          className={
            // Propiedades explícitas en vez de `transition-all`: solo cambian
            // ancho, fondo y glow al avanzar de intento. El comodín `all`
            // engancharía cualquier propiedad futura por accidente (y dispara
            // el motor a observar todo). Anima una vez por intento (ocasional),
            // así que 300ms está bien.
            "h-1.5 rounded-full transition-[width,background-color,box-shadow] duration-300 " +
            (i < attempts
              ? "w-6 bg-foreground/70"
              : i === attempts
                ? "w-6 bg-mint shadow-[0_0_8px_#7af0c8]"
                : "w-1.5 bg-muted-foreground/30")
          }
        />
      ))}
    </div>
  );
}
