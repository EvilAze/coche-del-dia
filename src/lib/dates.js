// src/lib/dates.js
// Helpers de fecha PUROS (sin dependencias) extraídos de statsService para
// poder testearlos sin arrastrar supabaseClient (que exige env vars al
// importarse).
//
// La zona horaria del juego es Europe/Madrid (la misma que usa el servidor),
// así el corte de día coincide cliente/servidor.

export function getMadridDateStr(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
  }).format(date);
}

// Resta `days` días naturales a una fecha "YYYY-MM-DD" de Madrid y devuelve
// la fecha resultante en el mismo formato. Anclamos a mediodía (lejos de los
// bordes DST) para que el cálculo no se desvíe en los cambios de hora.
function shiftMadridDay(todayStr, days) {
  const d = new Date(todayStr + "T12:00:00");
  d.setDate(d.getDate() - days);
  return getMadridDateStr(d);
}

// ¿La racha sigue viva? La BD guarda current_streak con el último valor
// calculado pero NO lo resetea hasta que el jugador vuelve a jugar. La racha
// está viva si el último día jugado es HOY u AYER en zona Madrid.
//
// Réplica de la regla de record_daily_result (ver
// scripts/2026-08-retirar-escudo-racha.sql): consecutivo o vuelta a empezar,
// sin excepciones. Hubo una tercera rama —el escudo de racha daba por viva la
// racha con un hueco de un día si quedaba inventario—, retirada con la mecánica:
// una racha que a veces perdona sin que el jugador sepa por qué deja de ser un
// contrato, y era justo lo que sostenía el "no pierdas tu racha de N días".
//
// `now` es inyectable para tests deterministas.
export function isStreakAlive(lastPlayedDate, now = new Date()) {
  if (!lastPlayedDate) return false;
  const today = getMadridDateStr(now);
  if (lastPlayedDate === today) return true;
  if (lastPlayedDate === shiftMadridDay(today, 1)) return true; // ayer
  return false;
}
