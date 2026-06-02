// src/components/GuessLog.jsx
// Panel de telemetría de intentos (opción B): tabla compacta SIEMPRE visible.
//
//   ┌ INTENTOS                                   ● ● ● ○ ○   ← dots (consumidos
//   │ MARCA            MODELO              AÑO                  en oro)
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
import AttemptDots from "./AttemptDots";

export default function GuessLog({
  guesses = [],
  pendingGuess = null,
  justRevealedIndex = -1,
  attempts = 0,
  maxAttempts = 5,
}) {
  const { t } = useT();

  if (guesses.length === 0 && !pendingGuess) return null;

  return (
    <div
      className="
        relative mb-4 mt-3 w-full min-w-0 overflow-hidden
        rounded-xl border border-white/[0.07] bg-white/[0.015] p-2.5 sm:p-3
      "
      role="group"
      aria-label={t("app.attemptsRemainingAria", {
        count: Math.max(0, maxAttempts - attempts),
        max: maxAttempts,
      })}
    >
      {/* Hairline dorada superior: mismo detalle premium que StatCard, ata el
          panel al lenguaje visual del resto de la web. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />

      {/* Barra de telemetría: etiqueta + dots de intentos a la derecha. */}
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.22em] text-muted">
          {t("app.attempts")}
        </span>
        <AttemptDots attempts={attempts} max={maxAttempts} />
      </div>

      {/* Cabecera única de columnas. */}
      <GuessRowHeader />

      {/* Filas en orden cronológico (más antiguo arriba); el intento en curso
          (pending) cierra la lista abajo. Cada fila entra con su animación
          (slide-up / flip-reveal) ya definida en GuessRow. */}
      <div className="mt-1.5 flex flex-col gap-1.5">
        {guesses.map((g, i) => (
          <GuessRow
            key={i}
            guess={g}
            index={i}
            justRevealed={i === justRevealedIndex}
          />
        ))}
        {pendingGuess && (
          <GuessRow
            key="pending"
            guess={pendingGuess}
            index={guesses.length}
            pending
          />
        )}
      </div>
    </div>
  );
}
