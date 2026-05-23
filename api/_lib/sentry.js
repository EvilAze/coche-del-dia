// api/_lib/sentry.js
// Captura de errores server-side (Vercel serverless functions) con Sentry.
//
// Diseño:
//   - Init perezoso: la primera vez que un endpoint llama a
//     captureServerError(), inicializamos Sentry. Las invocaciones
//     subsiguientes en la MISMA instancia warm reutilizan la init.
//   - Sin DSN configurado → no-op. En dev local los console.error
//     siguen siendo el único canal, como hasta ahora.
//   - PII scrubbing: limpia URLs con tokens y headers sensibles antes
//     de mandar el evento.
//
// Por qué no Sentry handlers / wrappers oficiales:
//   El integrador `Sentry.AWSLambda.wrapHandler` (y equivalentes) está
//   pensado para AWS Lambda y requiere adaptar el contrato de respuesta.
//   En Vercel functions cada endpoint ya tiene su propio try/catch con
//   un patrón consistente ("UNCAUGHT" log + 500 response). Añadir un
//   wrapper más complicaría el código por marginal ganancia.
//
// Variable de entorno (server):
//   SENTRY_DSN — DSN del proyecto Sentry para el backend. Si quieres
//                un solo proyecto compartido con el frontend, usa el
//                mismo valor que VITE_SENTRY_DSN. Recomendado tener
//                dos proyectos separados (frontend/backend) para
//                triage más rápido.
//
// Carpeta `_lib` (prefijada con `_`): Vercel la excluye del routing
// automático de funciones serverless. NO se publica como endpoint.

import * as Sentry from "@sentry/node";

let initialized = false;
let initializing = false;

// Mismas keys que el cliente. Cualquier token o pseudo-id en query
// debe enmascararse antes de salir del servidor.
const SENSITIVE_QUERY_KEYS = new Set([
  "t",
  "token",
  "id",
  "key",
  "secret",
  "access_token",
  "refresh_token",
]);

function scrubUrl(url) {
  if (typeof url !== "string" || url.length === 0) return url;
  try {
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
    return url;
  }
}

function scrubEvent(event) {
  if (event.request?.url) {
    event.request.url = scrubUrl(event.request.url);
  }
  // Header Authorization no debe llegar al dashboard.
  if (event.request?.headers) {
    if ("authorization" in event.request.headers) {
      event.request.headers.authorization = "[scrubbed]";
    }
    if ("cookie" in event.request.headers) {
      event.request.headers.cookie = "[scrubbed]";
    }
  }
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
  }
  return event;
}

function ensureInit() {
  if (initialized || initializing) return initialized;
  initializing = true;
  try {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) {
      // Sin DSN: no-op. Dev local o despliegue sin sentry.
      initializing = false;
      return false;
    }
    Sentry.init({
      dsn,
      tracesSampleRate: 0,
      sendDefaultPii: false,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "production",
      release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
      beforeSend: scrubEvent,
    });
    initialized = true;
    initializing = false;
    return true;
  } catch (err) {
    // Si Sentry falla al inicializar, no queremos arrastrar al endpoint.
    // Logueamos y seguimos sirviendo la respuesta original.
    // eslint-disable-next-line no-console
    console.warn("[sentry-server] init failed:", err?.message || err);
    initializing = false;
    return false;
  }
}

/**
 * Reporta un error a Sentry desde un endpoint serverless. Lleva un
 * objeto opcional `context` con tags para filtrar en el dashboard
 * (por endpoint, etc.). Es 100% non-throwing: si algo va mal aquí,
 * silenciamos para no romper la respuesta original del endpoint.
 *
 * Patrón de uso (en el catch de cada handler):
 *
 *   } catch (err) {
 *     console.error("[validate-guess] UNCAUGHT:", err);
 *     captureServerError(err, { endpoint: "validate-guess" });
 *     return res.status(500).json({ ... });
 *   }
 */
export function captureServerError(err, context = {}) {
  try {
    if (!ensureInit()) return;
    Sentry.captureException(err, {
      tags: context,
    });
  } catch {
    // Sentry roto: no contamina al endpoint.
  }
}
