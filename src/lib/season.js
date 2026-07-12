// src/lib/season.js
// Lógica PURA de temporada: días que faltan para el cierre (countdown del banner
// del ranking). Todo en fecha "calendario" de Madrid, sin horas — como el resto
// del ranking (el coche cambia a medianoche de Madrid).

// Devuelve ends_at - hoy en días de calendario. 0 = cierra hoy; 1 = mañana;
// negativo = ya cerró; null si la entrada no es una fecha válida.
export function daysUntilClose(endsAt, today = new Date()) {
  if (!endsAt || typeof endsAt !== "string") return null;
  const end = Date.parse(`${endsAt}T00:00:00Z`);
  if (Number.isNaN(end)) return null;
  // "hoy" en Madrid como YYYY-MM-DD → UTC midnight para restar días completos.
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(today);
  const now = Date.parse(`${todayStr}T00:00:00Z`);
  if (Number.isNaN(now)) return null;
  return Math.round((end - now) / 86400000);
}
