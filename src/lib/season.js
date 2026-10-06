// src/lib/season.js
// Lógica PURA de temporada: días que faltan para el cierre (countdown del banner
// del ranking) y el crédito que se pinta al final del filete de la foto. Todo en
// fecha "calendario" de Madrid, sin horas — como el resto del ranking (el coche
// cambia a medianoche de Madrid).

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

/**
 * En qué día del periodo estamos: «Día 10/14» y la regla de segmentos de la
 * tarjeta de temporada de la clasificación. Sirve igual para una temporada
 * (starts_at/ends_at) que para la semana del ranking semanal.
 *
 * Los dos extremos CUENTAN (una temporada del 1 al 14 dura 14 días, no 13) y
 * el día se acota a [1, total]: la temporada se lee de la base de datos con la
 * fecha de Madrid, pero el reloj del dispositivo puede ir un día por delante o
 * por detrás, y «Día 15/14» o «Día 0/14» delatarían el desfase en vez de
 * absorberlo.
 *
 * @returns {{ dia: number, total: number } | null} null si las fechas no valen.
 */
export function progresoPeriodo(desde, hasta, today = new Date()) {
  if (!desde || !hasta || typeof desde !== "string" || typeof hasta !== "string") return null;
  const ini = Date.parse(`${desde}T00:00:00Z`);
  const fin = Date.parse(`${hasta}T00:00:00Z`);
  if (Number.isNaN(ini) || Number.isNaN(fin) || fin < ini) return null;
  const quedan = daysUntilClose(hasta, today);
  if (quedan == null) return null;
  const total = Math.round((fin - ini) / 86400000) + 1;
  const dia = Math.min(total, Math.max(1, total - quedan));
  return { dia, total };
}

/**
 * El texto del crédito que ZoomStage pinta al final del filete, encima de la
 * foto: quién presenta la temporada o, si no hay colaboración, la temporada en
 * curso.
 *
 * POR QUÉ AQUÍ Y NO INLINE EN Configurator: para poder probarlo. La prioridad
 * (colaboración > temporada) y el «si no hay nada, no hay línea» son tres
 * ramas que se rompen en silencio — un `presenta_es` vacío que devolviera ""
 * en vez de null pintaría un filete con un hueco al final y nadie lo notaría
 * en una revisión. Además el build local de Windows se deja chunks por el
 * camino (ver docs), así que una función con test propio es la única
 * verificación fiable que tenemos antes del Preview.
 *
 * @param {object|null} season Fila de `seasons` tal cual la trae getCurrentSeason.
 * @param {string} locale "es" | "en".
 * @param {(k: string, vars?: object) => string} t Traductor inyectado.
 * @returns {string|null} null = sin crédito, la línea se queda como siempre.
 */
export function creditoTemporada(season, locale, t) {
  if (!season) return null;
  // El crédito de una colaboración manda: es contractual y ya nombra la
  // temporada de la que habla («USPI · POWERART»). Poner debajo «Temporada ·
  // lo que sea» sería decir dos veces lo mismo en un renglón de 9,5px.
  const presenta =
    (locale === "en" ? season.presenta_en : season.presenta_es) || null;
  if (presenta) return presenta;
  const tema = (locale === "en" ? season.label_en : season.label_es) || null;
  return tema ? t("prensa.temporada", { tema }) : null;
}
