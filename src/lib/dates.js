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
// Con streak freeze: si faltó EXACTAMENTE un día (jugó anteayer) pero tiene
// congelados disponibles, la racha sigue viva — se salvará al volver a jugar.
//
// `now` es inyectable para tests deterministas. `streakFreezes` por defecto 0
// (los callers sin inventario se comportan como antes).
export function isStreakAlive(lastPlayedDate, now = new Date(), streakFreezes = 0) {
  if (!lastPlayedDate) return false;
  const today = getMadridDateStr(now);
  if (lastPlayedDate === today) return true;
  if (lastPlayedDate === shiftMadridDay(today, 1)) return true; // ayer
  // Hueco de un día cubierto por un congelado disponible.
  if (streakFreezes > 0 && lastPlayedDate === shiftMadridDay(today, 2)) return true;
  return false;
}
