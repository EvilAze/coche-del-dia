// api/_lib/schedule-free.js
// Validación de "¿se puede liberar este día del calendario?". Extraída de
// lib/admin-handlers/schedule.js para poder testearla sin request ni BD, igual
// que compare-guess.js o score.js.
//
// Merece módulo propio porque es un guard sobre datos IRREVERSIBLES. Liberar un
// día borra su fila de `daily_cars`, y esa tabla no es una preferencia: es el
// registro de qué coche tocó cada día. De ahí derivan El Archivo, los logros y
// las estadísticas.
//
//   · HOY no se libera: la gente ya está jugando. Si pick_daily_car reeligiera,
//     las partidas en curso y las filas ya escritas en user_guesses /
//     daily_stats apuntarían a un coche que dejó de ser el del día.
//   · EL PASADO no se libera: borrar ahí no reordena nada, destruye histórico.
//
// Solo el futuro estricto es liberable, porque nadie lo ha jugado todavía.

export const FREE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ¿Es liberable esta fecha?
 *
 * Todas las fechas son strings YYYY-MM-DD en calendario Madrid. La comparación
 * lexicográfica de ese formato es cronológicamente correcta (mismo criterio que
 * el resto del handler), así que no hace falta parsear a Date y no hay riesgo
 * de que un cambio de horario se coma un día.
 *
 * @param {object} input
 * @param {*} input.date    Fecha pedida por el cliente (sin sanear).
 * @param {string} input.today    Hoy en Madrid.
 * @param {string} input.maxDate  Último día de la ventana visible del panel.
 * @returns {{ ok: true, date: string } | { ok: false, status: number, error: string }}
 *   En caso de error, `status` y `error` van tal cual a la respuesta HTTP —
 *   los mensajes están en español porque los lee el admin en el panel.
 */
export function validateFreeDate({ date, today, maxDate }) {
  const value = typeof date === "string" ? date.trim() : "";

  if (!FREE_DATE_RE.test(value)) {
    return { ok: false, status: 400, error: "Invalid date (expected YYYY-MM-DD)" };
  }
  // El orden importa: "hoy" y "pasado" son 409 (conflicto con el estado del
  // juego, no un error de formato) y merecen mensajes distintos, porque el
  // motivo por el que no se pueden tocar es distinto.
  if (value === today) {
    return {
      ok: false,
      status: 409,
      error: "El coche de hoy ya está en juego: no se puede liberar.",
    };
  }
  if (value < today) {
    return {
      ok: false,
      status: 409,
      error: "No se puede liberar un día pasado: es el histórico del juego.",
    };
  }
  if (value > maxDate) {
    return {
      ok: false,
      status: 400,
      error: `Solo se pueden liberar fechas posteriores a hoy y hasta ${maxDate}.`,
    };
  }
  return { ok: true, date: value };
}
