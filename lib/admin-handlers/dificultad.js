// lib/admin-handlers/dificultad.js
// La matemática de la dificultad observada, en un solo sitio y pura.
//
// POR QUÉ SEPARADA DEL HANDLER: estas dos constantes venían multiplicándose por
// el repo — el coste objetivo estaba copiado en analytics.js y en
// EditCarPanel.jsx, y la penalización por derrota vive además en el default de
// las RPCs de scripts/2026-06-difficulty-*.sql. Cuatro copias de un número que
// tiene que ser el mismo, y ninguna forma automática de notar que dejaron de
// serlo. Aquí quedan en una, con tests.
//
// POR QUÉ EL VEREDICTO ES DEL SERVIDOR Y NO DEL JSX: mismo criterio que
// estado.js deja escrito — los umbrales son POLÍTICA («¿a partir de cuándo un
// coche es demasiado difícil?»), no presentación. Puestos en el componente se
// convierten en números sueltos entre clases de Tailwind, que es donde nadie
// los encuentra para discutirlos.

// Coste objetivo: la moda cae entre el 3º y el 4º intento. Réplica del default
// p_target_cost de recompute_car_difficulty.
export const COSTE_OBJETIVO = 3.5;

// Lo que "cuesta" una derrota. Mayor que 5 a propósito: perder duele más que
// llegar apurado al quinto intento. Réplica del default p_loss_penalty.
export const PENALIZACION_DERROTA = 7.0;

// Bandas del veredicto, ASIMÉTRICAS a propósito: se tolera más dificultad que
// facilidad. Un coche fácil se adivina de reojo y la partida se acaba antes de
// empezar; uno difícil, aunque incomode, todavía se juega.
const MARGEN_FACIL = 0.5;
const MARGEN_DIFICIL = 0.7;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Convierte la fila cruda de get_car_report en lo que la ficha necesita
// enseñar. Los ratios vienen a null cuando no hay partidas: un 0% donde no se
// ha medido nada sería inventarse el estado, y eso ya nos ha costado un
// disgusto (regla 21 del CLAUDE.md, «degradar no es inventarse el estado»).
export function derivarMetricas(fila) {
  const total = num(fila?.total_games);
  const wins = num(fila?.wins);
  const losses = num(fila?.losses);
  const intentos = [
    num(fila?.attempt_1), num(fila?.attempt_2), num(fila?.attempt_3),
    num(fila?.attempt_4), num(fila?.attempt_5),
  ];

  if (total === 0) {
    return {
      total: 0, wins, losses, intentos,
      winRate: null, intentoMedio: null, pBy3: null, coste: null,
    };
  }

  // Σ(nº de intento × cuántos ganaron en él). Es el numerador tanto del intento
  // medio como del coste, así que se calcula una vez.
  const sumaIntentosGanados = intentos.reduce((acc, n, i) => acc + n * (i + 1), 0);

  return {
    total,
    wins,
    losses,
    intentos,
    winRate: wins / total,
    // Solo entre los que ganaron: una derrota no es "un sexto intento", es otra
    // cosa, y promediarla aquí mezclaría dos magnitudes.
    intentoMedio: wins > 0 ? sumaIntentosGanados / wins : null,
    pBy3: (intentos[0] + intentos[1] + intentos[2]) / total,
    coste: (sumaIntentosGanados + losses * PENALIZACION_DERROTA) / total,
  };
}

// Lectura humana del coste. Devuelve nivel + texto; el color lo elige el
// componente a partir del nivel, que es lo único que es presentación.
export function veredicto(coste) {
  if (typeof coste !== "number" || !Number.isFinite(coste)) {
    return { nivel: "desconocido", texto: "Sin datos suficientes" };
  }
  if (coste < COSTE_OBJETIVO - MARGEN_FACIL) {
    return { nivel: "facil", texto: "Demasiado fácil" };
  }
  if (coste > COSTE_OBJETIVO + MARGEN_DIFICIL) {
    return { nivel: "dificil", texto: "Demasiado difícil" };
  }
  return { nivel: "equilibrado", texto: "Equilibrado" };
}
