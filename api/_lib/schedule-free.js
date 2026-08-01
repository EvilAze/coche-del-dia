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

const FREE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Cuántos días de margen exigimos para asignar un coche SIN FOTO. Con 2, el
// primer día que puede recibir un borrador es pasado mañana.
//
// El motivo no es simetría con nada: un borrador en el día de MAÑANA deja menos
// de 24 h para subir la imagen, y si se le pasa, la jornada queda injugable para
// todo el mundo (no hay imagen que servir). Y no hay ninguna ventaja en usar
// mañana en vez de pasado mañana — el reparto del tema sale igual. Es riesgo sin
// contrapartida, así que se corta aquí.
//
// Hoy nunca entra: liberar solo toca días estrictamente futuros.
export const MIN_DRAFT_OFFSET_DAYS = 2;

// Días de calendario entre dos fechas YYYY-MM-DD. null si alguna no es válida.
// Se parsea a mediodía UTC-neutral (T00:00:00Z sobre ambas) para que la resta sea
// exacta en días y ningún cambio de hora se coma uno.
export function daysBetween(from, to) {
  if (!FREE_DATE_RE.test(String(from)) || !FREE_DATE_RE.test(String(to))) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * ¿Puede este día recibir un coche sin foto?
 *
 * @param {object} input
 * @param {string} input.date   Día a asignar (YYYY-MM-DD).
 * @param {string} input.today  Hoy en Madrid.
 * @param {number} [input.minOffsetDays]
 * @returns {boolean} false también si las fechas son inválidas — ante la duda,
 *   NO se permite el borrador. El fallo seguro es "solo coches con foto".
 */
export function draftsAllowedFor({ date, today, minOffsetDays = MIN_DRAFT_OFFSET_DAYS }) {
  const diff = daysBetween(today, date);
  if (diff === null) return false;
  return diff >= minOffsetDays;
}

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
