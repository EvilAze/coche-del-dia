// api/admin/[...slug].js
// ---------------------------------------------------------------------
// DISPATCHER admin: ruta catch-all que Vercel resuelve a UNA SOLA función
// serverless en lugar de N funciones separadas.
//
// Motivación: Vercel Hobby tiene un límite duro de 12 Serverless Functions
// por deployment. Tras añadir el panel de analítica llegamos a 13 (4 en
// admin/ × 6 en raíz × 3 en repesca/). Consolidando admin/ en este único
// dispatcher bajamos a 10, con margen para crecer.
//
// Cómo funciona:
//   • Vercel hace pattern match de `/api/admin/<lo-que-sea>` contra este
//     archivo. Pone el segmento dinámico en `req.query.slug` como array
//     (e.g., ["analytics"] para /api/admin/analytics).
//   • Buscamos en ROUTES el handler asociado al primer segmento.
//   • Llamamos al handler — cada uno mantiene su propia auth (requireAdmin),
//     validación de método, parseo de body, etc. Sin duplicación aquí.
//
// Los handlers viven en /lib/admin-handlers/ — FUERA de api/ a propósito
// para que Vercel NO los despliegue como funciones independientes. Solo
// se bundlean dentro de este dispatcher.
//
// Para añadir un nuevo endpoint admin en el futuro:
//   1. Crear lib/admin-handlers/mi-nuevo.js exportando default handler.
//   2. Importar y añadir entrada a ROUTES abajo.
//   3. Llamar desde el front a /api/admin/mi-nuevo.
// ---------------------------------------------------------------------

import { applyCors } from "../_lib/http.js";
import { conTimeout, TimeoutError } from "../_lib/timeout.js";
import analytics from "../../lib/admin-handlers/analytics.js";
import audit from "../../lib/admin-handlers/audit.js";
import estado from "../../lib/admin-handlers/estado.js";
import mensajes from "../../lib/admin-handlers/mensajes.js";
import moderacion from "../../lib/admin-handlers/moderacion.js";
import saveCar from "../../lib/admin-handlers/save-car.js";
import schedule from "../../lib/admin-handlers/schedule.js";
import seasons from "../../lib/admin-handlers/seasons.js";
import translate from "../../lib/admin-handlers/translate.js";
import analyzeImage from "../../lib/admin-handlers/analyze-image.js";
import describeCar from "../../lib/admin-handlers/describe-car.js";
import masters from "../../lib/admin-handlers/masters.js";

const ROUTES = {
  "analytics":     analytics,
  "audit":         audit,
  "estado":        estado,
  "mensajes":      mensajes,
  "moderacion":    moderacion,
  "save-car":      saveCar,
  "schedule":      schedule,
  "seasons":       seasons,
  "translate":     translate,
  "analyze-image": analyzeImage,
  "describe-car":  describeCar,
  "masters":       masters,
};

// PLAZO POR RUTA, en ms. El dispatcher es el único sitio por el que pasan los
// once handlers, así que es donde el plazo se pone una vez en vez de once.
//
// El 23 de agosto de 2026 el panel se pasó ocho minutos devolviendo 504: 25
// invocaciones muertas al agotar los 60 s de presupuesto, cada una con cuerpo
// HTML que el panel no sabe leer. Con plazo propio contestan un JSON antes de
// que Vercel las mate, que es la diferencia entre «vuelve a intentarlo» y una
// pantalla en blanco.
//
// No vale un número único: los tres handlers de IA hablan con un modelo y
// tardan decenas de segundos EN CONDICIONES NORMALES; cortarlos a 15 s sería
// romper lo que hoy funciona. Los de datos, en cambio, son lecturas a Supabase
// y 15 s ya es un orden de magnitud sobre su peor caso sano.
const PLAZO_MS = {
  _default: 15000,
  // Hablan con la API de IA: su normalidad son decenas de segundos. El plazo
  // solo está para ganarle por poco al presupuesto de Vercel (60 s) y poder
  // contestar JSON en vez de que nos maten a media frase.
  "analyze-image": 55000,
  "describe-car": 55000,
  "translate": 55000,
  // Sube la foto al CDN además de escribir en la base.
  "save-car": 45000,
  // Descarga, recodifica y sube varias fotos de varios MB por lote.
  "masters": 55000,
};

export default async function handler(req, res) {
  // CORS AQUÍ, EN EL DISPATCHER, y no en cada handler. Todos llevan
  // Authorization (requireAdmin), así que desde la app —origen
  // https://localhost, cross-origin contra producción— el navegador manda
  // primero un preflight OPTIONS. Sin responderlo, TODA llamada del panel
  // moría con «Failed to fetch» antes de salir del móvil: el panel entero
  // era inservible dentro del APK.
  //
  // En el dispatcher porque es la única puerta: los handlers viven fuera de
  // api/ (lib/admin-handlers/) y ya van por la decena; ponerlo en cada uno
  // sería repetir la misma línea N veces y olvidarla en la N+1. Aquí, un
  // endpoint admin nuevo nace con CORS resuelto. Antes del routing y de
  // cualquier auth: un preflight no lleva credenciales por definición, así que
  // gatearlo detrás de requireAdmin lo rechazaría siempre.
  if (applyCors(req, res)) return; // preflight OPTIONS / headers CORS

  // Vercel puede pasar req.query.slug como:
  //   • Array de strings  → e.g., ["analytics"] o ["nested", "deep"]
  //   • String suelta     → e.g., "analytics" (algunos runtimes lo simplifican
  //                         cuando solo hay 1 segmento)
  //   • undefined         → si la URL es /api/admin sin nada más
  // Normalizamos a array para tener UN solo flujo de lógica.
  let segments;
  const slug = req.query.slug;
  if (Array.isArray(slug)) {
    segments = slug;
  } else if (typeof slug === "string" && slug.length > 0) {
    segments = [slug];
  } else {
    segments = [];
  }

  // Fallback: si por alguna razón req.query.slug no está poblado (cambio de
  // runtime, runtime "edge" sin parseo de catch-all, etc.), parseamos
  // manualmente desde req.url. Esto nos hace robustos a cambios de Vercel.
  if (segments.length === 0 && req.url) {
    const path = req.url.split("?")[0];
    const m = path.match(/^\/api\/admin\/(.+?)\/?$/);
    if (m) {
      segments = m[1].split("/").filter(Boolean);
    }
  }

  // Solo soportamos 1 segmento (/api/admin/<accion>). Cualquier cosa
  // anidada o vacía → 404.
  if (segments.length !== 1) {
    return res.status(404).json({
      error: "Unknown admin endpoint",
      detail: `Path: /api/admin/${segments.join("/") || "(empty)"}`,
    });
  }

  const route = ROUTES[segments[0]];
  if (!route) {
    return res.status(404).json({
      error: "Unknown admin endpoint",
      detail: `Available: ${Object.keys(ROUTES).join(", ")}`,
    });
  }

  // El handler, con su plazo. `conTimeout` deja enganchado un catch a la
  // promesa original, así que si el handler acaba fallando DESPUÉS de que
  // hayamos contestado por plazo —incluido el ERR_HTTP_HEADERS_SENT de
  // intentar escribir sobre una respuesta ya enviada— ese rechazo no sale
  // como unhandled y no se lleva por delante la invocación.
  const nombre = segments[0];
  const plazo = PLAZO_MS[nombre] ?? PLAZO_MS._default;
  try {
    return await conTimeout(Promise.resolve(route(req, res)), plazo, {
      etiqueta: `admin/${nombre}`,
    });
  } catch (err) {
    // Si el handler ya contestó, no hay nada que rescatar: el plazo venció
    // sobre trabajo que hacía en segundo plano después de responder.
    if (res.headersSent || res.writableEnded) return;
    if (err instanceof TimeoutError) {
      console.error(`[admin] ${nombre} superó su plazo de ${plazo} ms`);
      res.setHeader("Retry-After", "10");
      return res.status(503).json({
        error: "Upstream temporarily unavailable",
        detail: `El endpoint ${nombre} no respondió en ${Math.round(plazo / 1000)} s.`,
      });
    }
    // Error de verdad del handler: que siga subiendo como siempre.
    throw err;
  }
}
