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
import saveCar from "../../lib/admin-handlers/save-car.js";
import schedule from "../../lib/admin-handlers/schedule.js";
import translate from "../../lib/admin-handlers/translate.js";

const ROUTES = {
  "analytics": analytics,
  "save-car":  saveCar,
  "schedule":  schedule,
  "translate": translate,
};

export default async function handler(req, res) {
  // Vercel pasa el segmento dinámico como array de strings. Para una
  // ruta como /api/admin/analytics → slug = ["analytics"]. Solo nos
  // interesa el primer segmento; cualquier slug adicional es un 404
  // (no soportamos endpoints anidados aquí).
  const slug = req.query.slug;
  const first = Array.isArray(slug) ? slug[0] : slug;

  if (!first || slug?.length > 1) {
    return res.status(404).json({
      error: "Unknown admin endpoint",
      detail: `Path: /api/admin/${Array.isArray(slug) ? slug.join("/") : slug}`,
    });
  }

  const route = ROUTES[first];
  if (!route) {
    return res.status(404).json({
      error: "Unknown admin endpoint",
      detail: `Available: ${Object.keys(ROUTES).join(", ")}`,
    });
  }

  return route(req, res);
}
