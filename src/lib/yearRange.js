// src/lib/yearRange.js
// La HORQUILLA del año: qué rango sigue vivo después de N intentos fallados.
//
// POR QUÉ EXISTE
// Al retirar el historial de la partida en móvil, el jugador perdía la única
// pieza que hacía trabajo deductivo de verdad: las flechas ↑/↓ acumuladas. Con
// marca y modelo no hay pérdida —el combo ELIMINA de la lista lo ya fallado, que
// es más fuerte que enseñarlo— pero el año no se elimina de ningún sitio, así
// que había que quedarse con su información y no con su presentación. Cinco
// filas de las que deducir un rango se convierten en el rango ya deducido.
//
// LA ARITMÉTICA (ojo con la tolerancia)
// Un año cuenta como acierto dentro de ±tolerancia. Así que un fallo no descarta
// solo el año tecleado: descarta toda su ventana. Con tolerancia 2 y el intento
// 2000 fallado «hacia arriba» (el real es MAYOR), sabemos que el real no está en
// 1998..2002 y que está por encima → el mínimo posible es 2003, no 2001. El
// error de olvidar la tolerancia daría una horquilla más ancha de lo real: no
// rompe nada, pero miente al jugador en dos años por cada extremo.

/** Extremos absolutos del juego (gemelos de los de YearField/GuessForm). */
export const MIN_YEAR = 1886;

/**
 * Horquilla viva a partir del historial de intentos.
 *
 * @param {Array} guesses  intentos tal cual los sirve el servidor: cada uno con
 *                         `anio: { val, status, direction }`. `direction` es
 *                         "up" (el real es mayor) o "down" (el real es menor).
 * @param {number} tolerance  margen ± que cuenta como acierto.
 * @param {number} maxYear    año máximo del juego (por defecto, el actual).
 * @returns {{min: number, max: number, acotada: boolean}}
 *          `acotada` = algún intento ha movido de verdad un extremo (si es
 *          false, no hay nada que enseñar todavía).
 */
export function yearRange(guesses, tolerance = 2, maxYear = new Date().getFullYear()) {
  let min = MIN_YEAR;
  let max = maxYear;

  for (const g of Array.isArray(guesses) ? guesses : []) {
    const a = g?.anio;
    // Solo los fallos acotan. Un acierto cierra la partida (o el campo), y un
    // intento sin dirección no dice hacia dónde mirar.
    if (!a || a.status === "correct") continue;
    const val = parseInt(a.val, 10);
    if (isNaN(val)) continue;

    if (a.direction === "up") {
      // El real es mayor Y está fuera de la ventana [val-tol, val+tol].
      min = Math.max(min, val + tolerance + 1);
    } else if (a.direction === "down") {
      max = Math.min(max, val - tolerance - 1);
    }
  }

  // Intentos contradictorios (no debería pasar con datos del servidor, pero un
  // snapshot corrupto de localStorage sí puede) dejarían min > max y la frase
  // quedaría absurda. Devolvemos el rango entero: preferimos no ayudar a mentir.
  if (min > max) return { min: MIN_YEAR, max: maxYear, acotada: false };

  return { min, max, acotada: min > MIN_YEAR || max < maxYear };
}
