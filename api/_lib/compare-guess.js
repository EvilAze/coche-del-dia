// api/_lib/compare-guess.js
// Comparación pura de un intento contra el coche del día. Extraída de
// api/validate-guess.js para poder testearla con Vitest sin montar una
// petición HTTP ni una base de datos: recibe datos, devuelve el `result`
// que consume el frontend (GuessRow pinta cada celda según su status).
//
// La estructura del objeto result es CONTRATO con el cliente (se persiste
// tal cual en user_guesses.guesses y en el localStorage de anónimos) — no
// cambiar campos sin migrar ambos lados.

// Margen de acierto del año: ±2 años cuenta como correcto. El año exacto de
// un coche es ambiguo (presentación vs producción vs facelift) y castigar
// por un año de diferencia frustraba sin aportar dificultad interesante.
export const ANIO_CORRECT_MARGIN = 2;

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * @param {object} input
 * @param {object} input.realCar  Coche del día: { marca, modelo, anio, pais }.
 * @param {object} input.guessRow Fila de `cars` del intento: { make, model, pais }.
 * @param {*}      input.guessAnio Año tecleado por el usuario (puede no ser
 *   numérico: se parsea defensivamente y un NaN cuenta como fallo).
 * @returns {{ marca: object, modelo: object, anio: object, win: boolean }}
 */
export function compareGuess({ realCar, guessRow, guessAnio }) {
  const anioNum = parseInt(guessAnio, 10);
  const anioCorrect =
    Number.isFinite(anioNum) &&
    Math.abs(anioNum - realCar.anio) <= ANIO_CORRECT_MARGIN;

  // Dirección de la pista SOLO si hay un año numérico que comparar. Sin esto,
  // un año basura (NaN) caía a "down" porque `NaN < real` es false, pintando
  // una flecha "has pasado de año" sin que el usuario hubiera dado ninguno.
  const anioDirection =
    anioCorrect || !Number.isFinite(anioNum)
      ? null
      : anioNum < realCar.anio
      ? "up"
      : "down";

  const marcaOk = normalize(guessRow.make) === normalize(realCar.marca);
  const modeloOk = normalize(guessRow.model) === normalize(realCar.modelo);
  // "partial" de marca = país de origen compartido. Solo tiene sentido si la
  // marca NO es la correcta (si lo es, el status correct ya domina).
  const paisOk =
    !marcaOk &&
    guessRow.pais &&
    realCar.pais &&
    guessRow.pais === realCar.pais;

  return {
    marca: {
      val: guessRow.make,
      status: marcaOk ? "correct" : paisOk ? "partial" : "wrong",
      pais: guessRow.pais,
    },
    modelo: {
      val: guessRow.model,
      status: modeloOk ? "correct" : "wrong",
    },
    anio: {
      val: String(guessAnio),
      status: anioCorrect ? "correct" : "wrong",
      direction: anioDirection,
    },
    win: marcaOk && modeloOk && anioCorrect,
  };
}
