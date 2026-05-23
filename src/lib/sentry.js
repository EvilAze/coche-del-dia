// src/lib/sentry.js
// Captura de errores client-side con Sentry. Diseño minimalista:
//
//   - SOLO errores. Performance monitoring y Session Replay desactivados:
//     el free tier de Sentry caduca quotas en horas cuando hay tráfico, y
//     los web vitals los emitimos por separado a Umami (ver webVitals.js).
//   - Sin DSN configurado → no-op total. En dev local los errores siguen
//     yendo a la consola como hoy, nada más.
//   - PII scrubbing agresivo: limpiamos query params con tokens, datos de
//     usuario en breadcrumbs, etc. Para no mandar a Sentry nada que valga
//     como credencial o pista del coche del día.
//
// Variable de entorno (cliente, prefijo VITE_ obligatorio en Vite):
//   VITE_SENTRY_DSN — DSN del proyecto Sentry para el frontend.
//
// Uso:
//   - Llamar a initSentry() una sola vez al arrancar (src/index.jsx).
//   - Usar SentryErrorBoundary del export para envolver el árbol.
//   - captureClientError(err, ctx?) para errores controlados que quieras
//     reportar manualmente sin que React los catchee como uncaught.

import * as Sentry from "@sentry/react";

let initialized = false;

// Lista de query params cuya presencia debe ocultarse del breadcrumb/URL
// antes de mandarlo a Sentry. Son tokens o pseudo-ids que dan ventaja al
// que los lea.
const SENSITIVE_QUERY_KEYS = new Set([
  "t",        // revealToken (api/daily-image)
  "token",    // genérico
  "id",       // pseudoCarId en /repesca?id=...
  "key",
  "secret",
  "access_token",
  "refresh_token",
]);

function scrubUrl(url) {
  if (typeof url !== "string" || url.length === 0) return url;
  try {
    // URL absoluta o relativa: si es relativa, le ponemos una base ficticia
    // para poder usar la API URL/URLSearchParams.
    const isRelative = !/^https?:\/\//i.test(url);
    const base = isRelative ? "http://x" : undefined;
    const parsed = new URL(url, base);
    let changed = false;
    for (const k of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(k.toLowerCase())) {
        parsed.searchParams.set(k, "[scrubbed]");
        changed = true;
      }
    }
    if (!changed) return url;
    const out = parsed.toString();
    return isRelative ? out.replace(/^http:\/\/x/, "") : out;
  } catch {
    // URL no parseable: no la tocamos.
    return url;
  }
}

function scrubEvent(event) {
  // 1) Limpiar request.url si Sentry lo ha capturado.
  if (event.request?.url) {
    event.request.url = scrubUrl(event.request.url);
  }
  // 2) Limpiar breadcrumbs (cada navegación queda como breadcrumb con url).
  if (Array.isArray(event.breadcrumbs)) {
    for (const b of event.breadcrumbs) {
      if (b?.data?.url) b.data.url = scrubUrl(b.data.url);
      if (b?.data?.to) b.data.to = scrubUrl(b.data.to);
      if (b?.data?.from) b.data.from = scrubUrl(b.data.from);
    }
  }
  // 3) Quitar el campo `user.email` si Sentry lo añadió. No queremos
  //    publicar emails en el dashboard ni en notificaciones.
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
  }
  return event;
}

export function initSentry() {
  if (initialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    // Sin DSN: dev local o despliegue sin Sentry. No init, no overhead.
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[sentry] VITE_SENTRY_DSN no configurado: skip init");
    }
    return;
  }
  try {
    Sentry.init({
      dsn,
      // Solo errores. Performance y replay OFF para no comernos el free tier.
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      // PII off por defecto. Lo blindamos también en scrubEvent.
      sendDefaultPii: false,
      // Etiqueta de release: el commit hash si está disponible
      // (Vercel lo expone como VERCEL_GIT_COMMIT_SHA → exposable a Vite
      // via define en vite.config si se quiere). Por ahora null.
      environment: import.meta.env.MODE,
      beforeSend: scrubEvent,
      // No queremos que un error en Sentry rompa la app. ignoreErrors
      // descarta ruido típico de browser-extensions / ResizeObserver.
      ignoreErrors: [
        "ResizeObserver loop limit exceeded",
        "ResizeObserver loop completed with undelivered notifications.",
        // Errores típicos de adblock interrumpiendo fetch a analytics.
        /^Load failed$/,
        /NetworkError when attempting to fetch resource/,
      ],
    });
    initialized = true;
  } catch (err) {
    // Si la init de Sentry falla por cualquier motivo, no debemos
    // arrastrar a la app con ella. Logueamos y seguimos.
    // eslint-disable-next-line no-console
    console.warn("[sentry] init failed:", err?.message || err);
  }
}

/**
 * Reporte manual de un error a Sentry. Útil para errores que ya cazas
 * con try/catch pero quieres tener en el dashboard. Si Sentry no está
 * inicializado, no hace nada.
 */
export function captureClientError(err, context = {}) {
  if (!initialized) return;
  try {
    Sentry.captureException(err, { tags: context });
  } catch {
    // ignore
  }
}

/**
 * ErrorBoundary preconfigurado de Sentry. Envuelve un subárbol y, si
 * algún componente lanza durante el render, manda el error y muestra
 * el fallback. Si Sentry no está inicializado, el ErrorBoundary sigue
 * funcionando (Sentry.ErrorBoundary captura locally; solo no manda al
 * servidor, que es lo que queremos en dev).
 */
export const SentryErrorBoundary = Sentry.ErrorBoundary;
