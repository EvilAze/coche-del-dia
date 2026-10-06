// api/_lib/registro-puntos.js
// Registro de puntos y racha al terminar la partida diaria, CON REINTENTO SEGURO.
//
// EL PROBLEMA. `record_daily_result_v2` es lo único que mueve `stats`: puntos,
// victorias y racha. Si esa llamada falla, el jugador ve su partida terminada y
// los puntos base (score.persisted = false) y NO ve ningún error — pero `stats`
// no se ha tocado, así que al día siguiente `last_played_date` ya no es «ayer»,
// la racha vuelve a 1 y el bonus a 0. Nada reintenta después. Y era un plazo de
// 4 s SIN reintento a propósito, por esto que decía el comentario del handler:
//
//     un segundo intento lanzado detrás de un plazo agotado —cuando el primero
//     PUDO haber commiteado— vuelve con `alreadyRecorded: true` y basePoints 0.
//
// O sea: el reintento no era inseguro para la BASE DE DATOS (la RPC es
// idempotente por `last_played_date`), era inseguro para lo que le CONTAMOS al
// jugador. Aquí se resuelve esa mitad, y el reintento deja de dar miedo.
//
// POR QUÉ UN `alreadyRecorded` EN EL SEGUNDO INTENTO SE PUEDE RECONSTRUIR.
//   Este código solo se ejecuta al cerrar una partida, y el handler ya cierra
//   el paso a una partida terminada («Game already finished», 403) antes de
//   llegar aquí: nadie más puede haber registrado ESTA partida. Por tanto, si en
//   el intento 2 la RPC dice «ya registrado», el que lo registró fue el
//   intento 1, que sí llegó a commitear y solo perdió la respuesta. Y la RPC,
//   al decir «ya registrado», devuelve el estado YA ACTUALIZADO (la racha y el
//   total de hoy), de donde sale todo lo que falta:
//     · base  = basePointsFor(intento, victoria)      — función pura
//     · bonus = streakBonusFor(racha devuelta)        — la racha ya incluye hoy
//   Es lo que habría devuelto el primer intento si hubiera llegado. Si en el
//   intento 1 llega `alreadyRecorded`, NO se reconstruye: ahí no hay un intento
//   nuestro previo que lo explique, y se devuelve tal cual.
//
// QUÉ SE REINTENTA Y QUÉ NO. Solo lo que es el servicio, no la respuesta:
//   · el plazo vencido, y la red caída (supabase-js no lanza: devuelve
//     `status` 0), 408, 429 y los 5xx.
//   · NO los 4xx. Un `RAISE EXCEPTION` de la RPC («No game state for today»,
//     «Attempt mismatch», «Winning guess does not match real car»…) llega como
//     400: es una respuesta definitiva y repetirla da lo mismo, solo que
//     gastando otros 4 s. Un 401 con el token caducado tampoco.
//
// PRESUPUESTO. Sube el peor caso de validate-guess en un plazo (PLAZOS.SUPABASE);
// el test de PLAZOS (timeout.test.js) suma la cadena entera y falla si se sale.

import { conTimeout, PLAZOS } from "./timeout.js";
import { basePointsFor, streakBonusFor } from "./score.js";

const ETIQUETA = "record_daily_result_v2";

/**
 * ¿El fallo es del servicio (merece otro intento) o es una respuesta definitiva?
 *
 * @param {number|undefined} status HTTP de PostgREST (0 = ni llegó a haber respuesta)
 * @param {{ code?: string }|undefined} error
 */
export function esFalloDeServicio(status, error) {
  if (typeof status === "number") {
    return status === 0 || status === 408 || status === 429 || status >= 500;
  }
  // Sin status (no debería pasar con supabase-js): un error sin código de
  // Postgres no es una respuesta de la base, es la red.
  return !error?.code;
}

/**
 * Lo que la RPC habría devuelto si su primera respuesta no se hubiera perdido.
 * Conserva `currentStreak`, `maxStreak` y `totalScore` tal y como llegan (ya son
 * el estado de después de hoy) y rehace solo lo que `alreadyRecorded` pone a 0.
 */
function reconstruir(data, { won, attemptNumber }) {
  const basePoints = basePointsFor(attemptNumber, won);
  const streakBonus = streakBonusFor(data.currentStreak, won);
  return {
    ...data,
    basePoints,
    streakBonus,
    totalPoints: basePoints + streakBonus,
    // Esta petición SÍ lo registró (a través de su primer intento).
    alreadyRecorded: false,
  };
}

/**
 * Registra el resultado del día con plazo y UN reintento.
 *
 * @param {() => PromiseLike<{ data: any, error: any, status?: number }>} llamar
 *   FÁBRICA de la llamada, no la llamada: un query builder de supabase-js es un
 *   thenable perezoso, y cada intento necesita el suyo.
 * @param {{ won: boolean, attemptNumber: number, intentos?: number, plazo?: number }} opts
 * @returns {Promise<object|null>} el jsonb de la RPC (o su reconstrucción);
 *   `null` si la RPC contestó sin datos.
 * @throws el último error, si se agotan los intentos o el fallo es definitivo.
 */
export async function registrarResultadoDiario(
  llamar,
  { won, attemptNumber, intentos = 2, plazo = PLAZOS.SUPABASE }
) {
  let ultimoError;

  for (let i = 1; i <= intentos; i++) {
    let respuesta;
    try {
      respuesta = await conTimeout(llamar(), plazo, { etiqueta: ETIQUETA });
    } catch (err) {
      // Plazo vencido, o una excepción de red que supabase-js sí dejó escapar.
      ultimoError = err;
      console.error(`[registro-puntos] intento ${i}/${intentos}:`, err?.message || err);
      continue;
    }

    const { data, error, status } = respuesta || {};

    if (error) {
      if (!esFalloDeServicio(status, error)) throw error; // definitivo: no se repite
      ultimoError = error;
      console.error(
        `[registro-puntos] intento ${i}/${intentos} (HTTP ${status}):`,
        error.message || error
      );
      continue;
    }

    if (data && i > 1 && data.alreadyRecorded === true) {
      console.warn(
        "[registro-puntos] el intento anterior sí se guardó; se reconstruye la puntuación"
      );
      return reconstruir(data, { won, attemptNumber });
    }

    return data ?? null;
  }

  throw ultimoError;
}
