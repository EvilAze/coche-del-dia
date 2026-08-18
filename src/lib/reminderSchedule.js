// src/lib/reminderSchedule.js
// QUÉ DÍAS TOCA AVISAR. Función pura, fuera de notifications.js, para poder
// probar la aritmética de fechas sin Capacitor delante — que es donde están
// todos los errores de esto (el cambio de hora, el aviso de hoy que ya pasó, el
// día que ya jugaste).
//
// ─── POR QUÉ UNA VENTANA Y NO UNA REPETICIÓN ────────────────────────────────
// El recordatorio era UNA notificación con `schedule.on: { hour: 20 }`, o sea
// una repetición que Android dispara sola todos los días. Nunca moría, y esa
// era su virtud. Pero también era su defecto: **no hay forma de saltarse un
// día concreto de una repetición**. Se cancela entera o suena.
//
// Y sonaba siempre. Quien juega a las nueve de la mañana recibía a las ocho de
// la tarde un «¡No pierdas tu racha de 48 días!» por una racha que había
// asegurado once horas antes. No es solo ruido: el texto afirma algo falso, y
// un recordatorio que miente enseña a ignorar los recordatorios.
//
// Para saltarse el día que ya jugaste hay que programar disparos SUELTOS, con
// su fecha exacta, y volver a llenar la ventana cada vez que la app se abre.
//
// EL PRECIO, dicho en alto: si alguien no abre la app en DIAS_VENTANA días, la
// ventana se agota y deja de recibir avisos. Es una decisión, no un descuido —
// se eligió con el usuario. A los 14 días sin abrir, seguir dando la matraca
// todas las tardes no recupera a nadie; molesta a quien ya se fue.

// 14 días: dos semanas de margen sin abrir la app. Por debajo de una semana la
// ventana se agotaría en una gripe; muy por encima, el copy de racha que
// congelamos al programar (ver abajo) envejece hasta no significar nada.
export const DIAS_VENTANA = 14;

/**
 * Las fechas exactas en las que debe sonar el recordatorio.
 *
 * @param {object}  opts
 * @param {Date}    opts.ahora      Momento actual (inyectable para test).
 * @param {boolean} opts.yaJugoHoy  Si la partida de hoy ya está cerrada.
 * @param {number}  opts.hora       Hora local del aviso.
 * @param {number}  opts.minuto
 * @param {number}  opts.dias       Tamaño de la ventana.
 * @returns {Date[]} Fechas futuras, en orden, una por día.
 */
export function proximosAvisos({
  ahora,
  yaJugoHoy = false,
  hora,
  minuto = 0,
  dias = DIAS_VENTANA,
}) {
  // El aviso de HOY a la hora fijada. Se construye con el constructor de
  // componentes locales (no con UTC) a propósito: el jugador quiere las 20:00
  // de SU reloj, y así el cambio de hora lo resuelve el motor de fechas.
  const primero = new Date(
    ahora.getFullYear(),
    ahora.getMonth(),
    ahora.getDate(),
    hora,
    minuto,
    0,
    0
  );

  // Hoy solo cuenta si quedan dos condiciones: que aún no haya pasado la hora
  // —programar un aviso en el pasado es, según la versión de Android, o un
  // disparo inmediato o nada— y que no haya jugado ya. Cualquiera de las dos
  // que falle, empezamos mañana.
  if (primero.getTime() <= ahora.getTime() || yaJugoHoy) {
    primero.setDate(primero.getDate() + 1);
  }

  const salida = [];
  for (let i = 0; i < dias; i++) {
    const d = new Date(primero.getTime());
    // setDate sobre el día del mes resuelve solo el fin de mes y el año; y
    // conserva la hora de pared al cruzar un cambio de horario, que es
    // justamente lo que queremos (las 20:00 siguen siendo las 20:00).
    d.setDate(primero.getDate() + i);
    salida.push(d);
  }
  return salida;
}
