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
//
// Pero OJO con la razón, porque la trampa fácil de argumentar es la falsa:
// no vale decir «prev solo contiene coches que fueron el coche del día,
// luego una repesca no puede estar ahí» — es justo al revés, HABER SIDO el
// coche del día es el requisito para entrar al bombo de la repesca, así que
// eso no los distingue en absoluto.
//
// Lo que de verdad los mantiene disjuntos son dos invariantes estrechas:
//   (i)  `pick_daily_car` excluye cualquier coche que ya tenga fila en
//        daily_cars, así que un coche tiene como mucho UNA fila en toda la
//        tabla.
//   (ii) el cambio de emergencia es un UPDATE: el coche saliente pierde su
//        fila en el mismo instante en que entra en prev_car_ids — y con ella
//        sale también del bombo de la repesca.
//
// Es frágil, y hay que saberlo: el día que alguien guarde una fila de
// histórico del saliente (por ejemplo para arreglar la atribución de
// estadísticas), la trampa vuelve a colarse por la puerta de al lado y este
// acotado deja de bastar.

/**
 * @param {object} input
 * @param {string} input.carIdVigente        El coche que dice daily_cars ahora.
 * @param {string[]} [input.prevCarIds]      Salientes de hoy, en orden.
 *   OJO: un array vacío es una AFIRMACIÓN («hoy no ha habido cambio»), no un
 *   «no he podido averiguarlo». Quien no pueda leerlo de verdad debe fallar,
 *   nunca pasar [] — con [] se le sirve tablero nuevo a un congelado y el día
 *   se puede rejugar.
 * @param {Array<{car_id: string}>} [input.filasUsuario]  TODAS las filas de
 *   user_guesses de hoy del usuario logueado que casen con {vigente} ∪ prev.
 *   Es un array y no una fila porque el desempate lo hace esta función: el
 *   llamador no puede expresarlo en una consulta y dejarlo en manos de un
 *   `limit(1)` sin orden es dejárselo a Postgres.
 * @param {boolean} [input.hayUsuario]  ¿La petición trae sesión iniciada?
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
  filasUsuario = [],
  hayUsuario = false,
  selloCliente = null,
  sellosPorCarId = {},
  intentosAnon = 0,
}) {
  // El coche vigente NO es un saliente aunque aparezca en la lista: un swap
  // A→B→A deja a A en las dos, y sin esto marcaríamos como «congelado» a quien
  // está perfectamente al día.
  const prev = (Array.isArray(prevCarIds) ? prevCarIds : []).filter(
    (id) => id && id !== carIdVigente
  );
  const filas = (Array.isArray(filasUsuario) ? filasUsuario : []).filter(
    (f) => f && f.car_id
  );
  const salida = (carId, congelado, cocheCambiado) => ({ carId, congelado, cocheCambiado });

  // 1. LOGUEADO CON FILA. Manda sobre todo lo demás: es lo único que el
  //    servidor escribió él mismo. Acotado a {vigente} ∪ prev para dejar fuera
  //    las repescas (ver la nota de arriba).
  //
  //    El desempate —si hubiera fila en una revisión anterior Y en la vigente,
  //    gana la anterior— se hace AQUÍ, y es el mismo que aplica el parche SQL
  //    de record_daily_result_v2 buscando `car_id = any(v_prev)`. Las dos
  //    copias tienen que decir lo mismo o el jugador validaría contra un coche
  //    y puntuaría contra otro.
  const filaCongelada = filas.find((f) => prev.includes(f.car_id));
  if (filaCongelada) return salida(filaCongelada.car_id, true, false);

  const filaVigente = filas.find((f) => f.car_id === carIdVigente);
  if (filaVigente) return salida(carIdVigente, false, false);

  // 2. ANÓNIMO CON PARTIDA EMPEZADA. Su ancla es el sello del token, que va
  //    firmado junto al contador de intentos: no puede quedarse con el coche
  //    viejo Y con cinco intentos nuevos.
  //
  //    SOLO sin sesión iniciada. El cliente manda la cabecera X-Anon-Session
  //    esté logueado o no, y nada la borra al registrarse: sin este guard, a
  //    quien jugó anónimo y luego se hizo cuenta se le anclaría al coche de su
  //    partida anónima en vez de al del día.
  if (!hayUsuario && selloCliente && intentosAnon > 0) {
    const carIdCongelado = prev.find((id) => sellosPorCarId[id] === selloCliente);
    if (carIdCongelado) return salida(carIdCongelado, true, false);
  }

  // 3. EL RESTO JUEGA EL COCHE VIGENTE. Y si traía un sello que no es el suyo,
  //    está mirando una foto que ya no corresponde: hay que avisarle antes de
  //    que responda, o se le puntuaría un intento sobre el coche equivocado.
  //
  //    Dos guardas, y las dos son para no dejar sin jugar a quien no ha hecho
  //    nada mal:
  //      · Sin salientes NO HAY NADA QUE HAYA CAMBIADO. Un sello que no casa es
  //        entonces cualquier otra cosa —un token de ayer, el secreto rotado, un
  //        cliente viejo— y tratarlo como «el coche cambió» manda a recargar en
  //        bucle a quien nunca podrá refrescar ese sello.
  //      · Si no sabemos el sello del coche vigente, NO PODEMOS COMPARAR. «No lo
  //        sé» no es «no coincide»: sin secreto configurado, esta rama dejaría
  //        el juego entero en 409.
  const selloVigente = sellosPorCarId[carIdVigente];
  const cocheCambiado = Boolean(
    prev.length > 0 &&
      selloCliente &&
      typeof selloVigente === "string" &&
      selloVigente.length > 0 &&
      selloCliente !== selloVigente
  );
  return salida(carIdVigente, false, cocheCambiado);
}
