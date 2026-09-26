// src/lib/primeraPartida.js
// ¿Es esta la PRIMERA partida de quien tiene la pantalla delante?
//
// POR QUÉ EXISTE. Los datos de septiembre de 2026 (guess_audit, 5-ago → 25-sep)
// separaron al que se va del que se queda con una sola variable: si TERMINA su
// primera partida vuelve al día siguiente uno de cada cuatro; si la abandona,
// uno de cada veinticinco. Y el sitio donde la abandona está medido: tras fallar
// la marca en el primer intento, el jugador fiel sigue en el 95% de los casos y
// el recién llegado solo en el 60%. Al fiel no le pasa nada distinto; sabe que
// fallar es parte del juego y que la foto se abre. El nuevo no lo sabe.
//
// Así que la ayuda va SOLO a la primera partida y no toca la dificultad: el
// jugador de nicho no ve nada nuevo a partir del segundo día.
//
// LAS SEÑALES, y por qué estas tres:
//   · `cd_dias_jugados` (lib/edicionApp): días distintos TERMINADOS en este
//     dispositivo. Es la prueba directa de «ya ha jugado aquí».
//   · `cocheDia_state` de un día ANTERIOR: el estado del anónimo, que existe
//     desde mucho antes que el contador de días. Cubre al veterano de antes de
//     agosto que no ha vuelto a terminar una partida en este móvil.
//   · La racha y el puesto (llegan después, de la sesión): cubren al veterano
//     con cuenta que estrena dispositivo. Por eso no se leen aquí sino en quien
//     consume esto — cambian en caliente y este módulo se lee UNA vez.
//
// Se lee síncrono y una sola vez al montar (initializer de useState): así la
// decisión es la misma en el primer pintado y durante toda la partida. Si se
// recalculara, `cd_dias_jugados` pasaría a 1 al cerrarse la partida y la ayuda
// desaparecería justo mientras se lee el resultado.
//
// Falla en silencio hacia «no es nuevo» (regla 9): sin localStorage no hay
// forma de saberlo, y enseñarle la ayuda a un veterano es peor que no
// enseñársela a un nuevo — el nuevo sigue teniendo «Cómo se juega».

const DIAS_KEY = "cd_dias_jugados";
const ESTADO_KEY = "cocheDia_state";

/**
 * @param {string} hoy  Día de juego en Madrid (`getMadridDateStr()`).
 * @param {Storage} [storage]  Inyectable para los tests.
 * @returns {boolean}
 */
export function sinHistorialLocal(hoy, storage) {
  try {
    const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return false;

    const dias = store.getItem(DIAS_KEY);
    if (dias) {
      const { n } = JSON.parse(dias);
      if (Number.isFinite(n) && n > 0) return false;
    }

    const estado = store.getItem(ESTADO_KEY);
    if (estado) {
      const { date } = JSON.parse(estado);
      // Un estado de HOY no dice nada: puede ser esta misma primera partida,
      // recargada a medias (los navegadores in-app recargan al volver).
      if (date && date !== hoy) return false;
    }

    return true;
  } catch {
    return false;
  }
}
