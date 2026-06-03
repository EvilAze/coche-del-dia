// src/lib/dates.js
// Helpers de fecha PUROS (sin dependencias) extraídos de useStats para poder
// testearlos sin arrastrar supabaseClient (que exige env vars al importarse).
//
// La zona horaria del juego es Europe/Madrid (la misma que usa el servidor),
// así el corte de día coincide cliente/servidor.

export function getMadridDateStr(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
  }).format(date);
}

// ¿La racha sigue viva? La BD guarda current_streak con el último valor
// calculado pero NO lo resetea hasta que el jugador vuelve a jugar. La racha
// está viva si el último día jugado es HOY u AYER en zona Madrid; si no, está
// rota aunque la BD aún tenga el valor antiguo.
//
// `now` es inyectable para tests deterministas (por defecto, el momento real).
export function isStreakAlive(lastPlayedDate, now = new Date()) {
  if (!lastPlayedDate) return false;
  const today = getMadridDateStr(now);
  if (lastPlayedDate === today) return true;
  // "Ayer" como día calendario, no como 24h en ms: Date.now() - 86_400_000
  // falla en los cambios de hora (±1h, último domingo de marzo y octubre).
  // Anclamos a mediodía (lejos de cualquier borde DST) y restamos un día.
  const d = new Date(today + "T12:00:00");
  d.setDate(d.getDate() - 1);
  const yesterday = getMadridDateStr(d);
  return lastPlayedDate === yesterday;
}
