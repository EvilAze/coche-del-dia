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

import analytics from "../../lib/admin-handlers/analytics.js";
import audit from "../../lib/admin-handlers/audit.js";
import saveCar from "../../lib/admin-handlers/save-car.js";
import schedule from "../../lib/admin-handlers/schedule.js";
import translate from "../../lib/admin-handlers/translate.js";
import analyzeImage from "../../lib/admin-handlers/analyze-image.js";

const ROUTES = {
  "analytics":     analytics,
  "audit":         audit,
  "save-car":      saveCar,
  "schedule":      schedule,
  "translate":     translate,
  "analyze-image": analyzeImage,
};

export default async function handler(req, res) {
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

  return route(req, res);
}
