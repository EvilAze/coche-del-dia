// api/_lib/date.js
// Fecha "hoy" en zona horaria de Madrid en formato YYYY-MM-DD.
//
// Por qué importa: todo el juego (coche del día, repesca, daily streak)
// pivota sobre "qué fecha es hoy en Madrid". Si un endpoint usa UTC y
// otro usa Madrid, un usuario podría ver el coche de mañana antes de
// hora o perder su racha por culpa del cambio de día desincronizado.
// Un único helper, un único concepto de "hoy".

/**
 * Devuelve la fecha "de hoy" en zona horaria de Madrid, en formato
 * YYYY-MM-DD (locale en-CA es el que devuelve ese formato de manera
 * consistente — el orden ISO sin separador raro).
 *
 * @returns {string} Por ejemplo "2026-05-21".
 */
export function todayInMadrid() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
