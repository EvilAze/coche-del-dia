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

  // Gastado = barra sólida (foreground/70), actual = barra menta con glow,
  // restante = barra tenue (muted/25). TODOS los tramos con el MISMO ancho.
  //
  // Antes el restante era un PUNTO pequeño (w-1.5): en el primer intento la
  // fila quedaba `▬ • • • •` — la pastilla-activa-+-puntos es EXACTAMENTE el
  // lenguaje visual de un PAGINADOR de carrusel. Un usuario en Reddit
  // (feedback 2026-07) lo leyó así: "¿puedo deslizar entre más fotos? solo
  // hay 1". Igualando el ancho, la fila se lee como una BARRA DE PROGRESO
  // segmentada (5 tramos), no como fotos deslizables. El color sigue siendo
  // el único canal de estado; el gap-1.5 (más ceñido) refuerza "una barra
  // partida en tramos" frente a "puntos sueltos".
  return (
    <div
      className="flex items-center justify-center gap-1.5"
      role="img"
      aria-label={t("app.attemptsRemainingAria", { count: remaining, max: maxAttempts })}
    >
      {Array.from({ length: maxAttempts }, (_, i) => (
        <span
          key={i}
          className={
            // Propiedades explícitas en vez de `transition-all`: solo cambian
            // fondo y glow al avanzar de intento (el ancho ya no varía). El
            // comodín `all` engancharía cualquier propiedad futura por
            // accidente (y dispara el motor a observar todo). Anima una vez
            // por intento (ocasional), así que 300ms está bien.
            "h-1.5 w-6 rounded-full transition-[background-color,box-shadow] duration-300 " +
            (i < attempts
              ? "bg-foreground/70"
              : i === attempts
                ? "bg-mint shadow-[0_0_8px_#7af0c8]"
                : "bg-muted-foreground/25")
          }
        />
      ))}
    </div>
  );
}
