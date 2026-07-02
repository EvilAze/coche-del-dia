// api/_lib/push.js
// Lógica PURA del recordatorio push, extraída del handler para poder testearla
// sin `web-push` (no instalado en el worktree) ni Supabase. El handler
// (api/cron/send-push.js) orquesta; aquí vive lo determinista.

// Copy del mensaje POR IDIOMA. Server-side no usa el i18n de cliente (useT),
// así que mantenemos aquí un mini-diccionario. GENÉRICO a propósito: NUNCA
// revela marca/modelo/año ni pista del coche (regla 5 de CLAUDE.md).
const PUSH_COPY = {
  es: { title: "El Coche del Día", body: "Ya puedes jugar al coche de hoy 🚗" },
  en: { title: "Car of the Day", body: "Today's car is ready — can you guess it? 🚗" },
};

// Devuelve el copy del locale; cae a español si no existe.
export function getPushCopy(locale) {
  return PUSH_COPY[locale] || PUSH_COPY.es;
}

// Payload que viaja en el push y que lee el service worker (event.data.json()).
export function buildPushPayload({ title, body, url }) {
  return JSON.stringify({ title, body, url });
}

// El navegador/servicio de push devuelve 404/410 cuando la suscripción ya no
// existe (usuario revocó permiso, desinstaló, etc.): esas se BORRAN. El resto
// (5xx, red) son reintentables → contamos fallo, no borramos aún.
export function classifySendError(err) {
  const code = err && err.statusCode;
  return code === 404 || code === 410 ? "expired" : "retry";
}

// Fecha 'YYYY-MM-DD' en horario de Madrid. El envío y la idempotencia por día
// se miden en la zona del juego (el coche cambia a medianoche de Madrid).
export function madridDateStr(date = new Date()) {
  // en-CA da directamente el formato YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
