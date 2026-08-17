// api/_lib/repesca/activa.js
// ¿Cuál es la repesca activa de un usuario, y en qué FECHA se juega?
//
// El sorteo apunta en `stats` dos cosas: qué coche (`last_repesca_car_id`) y
// qué día se sorteó (`last_repesca_at`). Los cuatro sitios que gatean la
// repesca —start, validate, image y el garaje— preguntaban todos lo mismo,
// `last_repesca_at === hoy`, y eso ataba la PARTIDA al día natural en vez de
// al día en que se sorteó. A las 00:00 de Madrid la comparación se volvía
// falsa y una partida viva moría de golpe: /repesca/validate y /repesca/image
// contestaban 403 «Repesca not active for this car» y /repesca/start en modo
// resume, 404. Quien empezaba a las 23:58 perdía los intentos, la foto y su
// repesca del día sin un solo mensaje que lo explicara.
//
// La partida se juega en SU fecha de sorteo, no en «hoy»: `user_guesses` ya se
// escribe con (user_id, car_id, date = fecha del sorteo), así que la fila vive
// ahí. Devolver coche y fecha JUNTOS es lo que impide que un gate vuelva a
// inventarse la fecha por su cuenta — el bug era exactamente eso, cuatro
// copias de la misma suposición.
//
// Lo que NO cambia es el presupuesto: se sortea una repesca por día natural
// (`puedeSortear`). Lo que deja de caducar a medianoche es la partida ya
// sorteada, que sigue siendo la activa hasta que se cierra o hasta que se
// sortea otra.
//
// Funciones puras para poder testear la regla sin base de datos.

/**
 * @param {{last_repesca_at?: string|null, last_repesca_car_id?: string|null}|null} statsRow
 *   Fila de `stats` del usuario (o null si no tiene).
 * @returns {{carId: string, fecha: string}|null} La repesca activa, o null.
 */
export function repescaActiva(statsRow) {
  const fecha = statsRow?.last_repesca_at || null;
  const carId = statsRow?.last_repesca_car_id || null;
  // Media fila no es una repesca: sin las dos piezas no hay ni coche que servir
  // ni fecha con la que localizar la partida en user_guesses.
  if (!fecha || !carId) return null;
  return { carId, fecha };
}

/**
 * ¿Puede sortearse una repesca NUEVA? Solo cuando la última activa es de un día
 * anterior — ese es el «una al día».
 *
 * Que la respuesta sea true con una partida vieja aún abierta es deliberado: es
 * la vía de escape que evita el bloqueo permanente. Si sortear exigiera cerrar
 * antes lo pendiente, una partida abandonada dejaría al jugador sin repesca
 * para siempre. En la práctica el garaje ofrece «Continuar» mientras la partida
 * siga viva (ver repescaEnCurso en consumo.js), así que solo se llega aquí tras
 * cerrarla o desde un cliente con datos rancios.
 *
 * @param {{carId: string, fecha: string}|null} activa Salida de repescaActiva.
 * @param {string} hoy Fecha de hoy en Madrid (YYYY-MM-DD).
 * @returns {boolean}
 */
export function puedeSortear(activa, hoy) {
  return !activa || activa.fecha !== hoy;
}
