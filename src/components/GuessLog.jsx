// src/components/GuessLog.jsx
// Panel de telemetría de intentos (opción B): tabla compacta SIEMPRE visible.
//
//   ┌ INTENTOS                                   ● ● ● ● ●   ← "shift lights"
//   │ MARCA            MODELO              AÑO                  (verde→ámbar→rojo)
//   │ [Audi ✓]         [A2 ✕]             [2015 ↑]           ← filas compactas
//   │ ...                                                       alineadas a grid
//
// Diseño "OEM+": una sola cabecera de columnas (sin repetir etiquetas por
// fila), filas consolidadas a una línea con su icono de validación a la
// derecha, y los colores de acierto/fallo con tintes oscuros sutiles +
// bordes definidos (definidos en GuessRow). Sin scroll ni toggle: las 5 filas
// caben holgadas en móvil.

import { useT } from "../i18n";
import GuessRow, { GuessRowHeader } from "./GuessRow";

export default function GuessLog({
  guesses = [],
  pendingGuess = null,
  justRevealedIndex = -1,
}) {
  const { t } = useT();

  if (guesses.length === 0 && !pendingGuess) return null;

  return (
    <div
      className="
        relative mb-4 mt-3 w-full min-w-0 overflow-hidden
        rounded-xl border border-white/[0.07] bg-white/[0.015] p-2.5 sm:p-3
      "
      aria-label={t("guessLog.label")}
    >
      {/* Hairline dorada superior: mismo detalle premium que StatCard, ata el
          panel al lenguaje visual del resto de la web. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />

      {/* Cabecera única de columnas. (El indicador de intentos — shift lights —
          vive ahora arriba, en la zona de acción, no aquí.) */}
      <GuessRowHeader />

      {/* Más RECIENTE arriba: el panel vive bajo el formulario, así que el
          intento recién hecho queda pegado al botón "Adivinar" (feedback
          inmediato) y los antiguos más abajo. El intento en curso (pending) va
          el primero. Cada fila entra con su animación (slide-up / flip-reveal). */}
      <div className="mt-1.5 flex flex-col gap-1.5">
        {pendingGuess && (
          <GuessRow
            key="pending"
            guess={pendingGuess}
            index={guesses.length}
            pending
          />
        )}
        {guesses
          .map((g, i) => ({ g, i }))
          .reverse()
          .map(({ g, i }) => (
            <GuessRow
              key={i}
              guess={g}
              index={i}
              justRevealed={i === justRevealedIndex}
            />
          ))}
      </div>
    </div>
  );
}
