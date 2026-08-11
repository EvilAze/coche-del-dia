// api/_lib/repesca/consumo.js
// ¿Cuándo se gasta la repesca del día?
//
// Regla: con el PRIMER INTENTO, no con el sorteo.
//
// El sorteo sigue apuntándose en `stats.last_repesca_at` / `last_repesca_car_id`
// (es lo que fija el coche y bloquea el re-sorteo: /api/repesca/start devuelve
// siempre el mismo). Pero entre ese apunte y la primera tecla hay 2,5-5 s de
// animación de barajeo y una navegación de página completa a /repesca — que en
// la app es un reinicio del WebView entero: arranque de Capacitor, sesión de
// Supabase, `start` en modo resume y la foto por red. Si algo interrumpe esa
// ventana (salir, que el sistema mande la app a segundo plano, que caiga la red,
// que la foto no llegue), el sorteo quedaba consumido sin que el jugador hubiera
// visto una sola pista, y El Archivo le decía «hoy ya no te queda repesca».
// Pasó en producción el 12-ago-2026: un sorteo apuntado, cero intentos en
// guess_audit y cero filas en user_guesses.
//
// La partida solo existe en `user_guesses` cuando /api/repesca/validate escribe
// el primer intento, así que la propia tabla ES el registro de "llegó a
// jugarse". No hace falta columna nueva ni fila fantasma: se deriva.
//
// Función pura para poder testear la regla sin base de datos.
//
// @param {{guesses?: unknown, status?: string}|null} row Fila de user_guesses
//   del sorteo de hoy (user_id, car_id sorteado, date=hoy), o null si no existe.
// @returns {boolean} true si el jugador llegó a intentarlo.
export function repescaJugada(row) {
  if (!row) return false;
  // Una partida cerrada cuenta siempre, aunque `guesses` llegue ilegible.
  if (row.status === "won" || row.status === "lost") return true;
  // `guesses` es jsonb; aceptamos también texto por si la columna viajase sin
  // tipar (el SQL de temporadas castea `guesses::jsonb`, señal de que pasa).
  try {
    const arr =
      typeof row.guesses === "string" ? JSON.parse(row.guesses) : row.guesses;
    return Array.isArray(arr) && arr.length > 0;
  } catch {
    return false;
  }
}
