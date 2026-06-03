// src/components/AttemptDots.jsx
// Indicador de intentos estilo Wordle: una fila de puntos que codifica el
// resultado de cada intento. Lo usa el modo Repesca (y cualquier flujo que
// quiera el detalle acierto/fallo por intento):
//   - intento fallado            → rojo
//   - intento ganador (el último)→ verde + énfasis
//   - intento actual (en juego)  → dorado + énfasis
//   - intentos restantes         → gris (border-strong)
//
// NOTA: el panel de guesses del juego principal NO usa este componente; pinta
// sus propios pips "gastado/restante" en dorado (ver GuessLog).

export default function AttemptDots({ attempts, max, won }) {
  return (
    <div className="flex gap-1.5 justify-center my-3">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`
            w-2 h-2 rounded-full transition-all duration-300
            ${i < attempts
              ? won && i === attempts - 1
                ? "bg-green-400 scale-125"
                : "bg-red-400"
              : won
              ? "bg-border-strong"
              : i === attempts
              ? "bg-accent scale-125"
              : "bg-border-strong"
            }
          `}
        />
      ))}
    </div>
  );
}
