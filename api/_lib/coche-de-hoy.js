// api/_lib/coche-de-hoy.js
// ¿A qué coche está anclado quien pregunta?
//
// Desde el cambio de emergencia, el coche del día ya no es «el que dice
// daily_cars»: es EL TUYO. Quien ya tenía partida cuando se cambió el coche
// sigue con el suyo hasta medianoche; quien no había empezado ve el nuevo. Así
// nadie rejuega el día y a nadie se le corta una partida a medias.
//
// PURA Y SIN I/O a propósito, por dos motivos:
//   · La consumen los DOS runtimes: get-daily-car es Edge y validate-guess es
//     Node. Con I/O dentro harían falta dos versiones, y dos versiones divergen.
//   · Es un guard sobre partidas en curso. Su garantía no puede ser que alguien
//     lea el if con atención — tiene que ser un test. Mismo criterio que
//     schedule-free.js.
//
// LA TRAMPA QUE HAY QUE CONOCER: las partidas de repesca se guardan en
// `user_guesses` con la MISMA fecha que la diaria y otro car_id, y no hay
// columna que las distinga. Por eso el ancla del logueado no es «su fila de
// hoy» sino «su fila de hoy CUYO car_id sea el vigente o uno de los salientes».
// Sin ese acotado, a quien jugara una repesca se le serviría el coche de la
// repesca como si fuera el del día.

/**
 * @param {object} input
 * @param {string} input.carIdVigente        El coche que dice daily_cars ahora.
 * @param {string[]} [input.prevCarIds]      Salientes de hoy, en orden.
 * @param {{car_id: string}|null} [input.filaUsuario]  Fila de user_guesses de
 *   hoy del usuario logueado (null si es anónimo o no ha jugado).
 * @param {string|null} [input.selloCliente] Sello que trae el cliente.
 * @param {Object<string,string>} [input.sellosPorCarId] carId → sello, ya
 *   calculados por el endpoint (el HMAC es asíncrono; esto es síncrono).
 * @param {number} [input.intentosAnon]      Intentos gastados según el token.
 * @returns {{carId: string, congelado: boolean, cocheCambiado: boolean}}
 *   `congelado` = está jugando una revisión anterior.
 *   `cocheCambiado` = el cliente está mirando una foto que ya no es la de su
 *   partida y debe recargar antes de responder.
 */
export function resolverCocheDelUsuario({
  carIdVigente,
  prevCarIds = [],
  filaUsuario = null,
  selloCliente = null,
  sellosPorCarId = {},
  intentosAnon = 0,
}) {
  const prev = Array.isArray(prevCarIds) ? prevCarIds.filter(Boolean) : [];
  const salida = (carId, congelado, cocheCambiado) => ({ carId, congelado, cocheCambiado });

  // 1. LOGUEADO CON FILA. Manda sobre todo lo demás: es lo único que el
  //    servidor escribió él mismo. Acotado a {vigente} ∪ prev para dejar fuera
  //    las repescas (ver la nota de arriba).
  if (filaUsuario?.car_id) {
    if (prev.includes(filaUsuario.car_id)) {
      // Desempate escrito también en el parche SQL de record_daily_result_v2:
      // si hubiera fila en una revisión anterior Y en la vigente, gana la
      // anterior. Por construcción no puede pasar (el ancla impide que se cree
      // la segunda), pero las dos copias tienen que decir lo mismo.
      return salida(filaUsuario.car_id, true, false);
    }
    if (filaUsuario.car_id === carIdVigente) {
      return salida(carIdVigente, false, false);
    }
    // Ni el vigente ni un saliente → es una repesca. No ancla nada.
  }

  // 2. ANÓNIMO CON PARTIDA EMPEZADA. Su ancla es el sello del token, que va
  //    firmado junto al contador de intentos: no puede quedarse con el coche
  //    viejo Y con cinco intentos nuevos.
  if (selloCliente && intentosAnon > 0) {
    const congelado = prev.find((id) => sellosPorCarId[id] === selloCliente);
    if (congelado) return salida(congelado, true, false);
  }

  // 3. EL RESTO JUEGA EL COCHE VIGENTE. Y si traía un sello que no es el suyo,
  //    está mirando una foto que ya no corresponde: hay que avisarle antes de
  //    que responda, o se le puntuaría un intento sobre el coche equivocado.
  const cocheCambiado = Boolean(
    selloCliente && selloCliente !== sellosPorCarId[carIdVigente]
  );
  return salida(carIdVigente, false, cocheCambiado);
}
