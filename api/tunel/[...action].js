// api/tunel/[...action].js
// Catch-all que agrupa los endpoints del modo libre (Túnel de viento) en UNA
// sola Serverless Function, para no gastar slots del límite de 12 del plan
// Hobby de Vercel. Mismo patrón que api/cron/[...job].js y api/admin/[...slug].js:
// la lógica vive en api/_lib/tunel/ (prefijo _ → Vercel NO la cuenta como
// función) y aquí solo enrutamos.
//   · /api/tunel/start    → start
//   · /api/tunel/validate → validate
// Cada handler conserva su propia auth/CORS/validación de método.

import start from "../_lib/tunel/start.js";
import validate from "../_lib/tunel/validate.js";

const ROUTES = { start, validate };

export default async function handler(req, res) {
  // Vercel a veces NO puebla req.query.action en un catch-all (verificado en
  // prod con api/cron/[...job].js) → fallback: parseamos el segmento de req.url.
  const raw = req.query.action;
  let name;
  if (Array.isArray(raw)) name = raw.join("/");
  else if (typeof raw === "string" && raw.length > 0) name = raw;
  else if (req.url) {
    const path = req.url.split("?")[0];
    const m = path.match(/^\/api\/tunel\/(.+?)\/?$/);
    if (m) name = m[1];
  }

  const route = ROUTES[name];
  if (!route) {
    return res.status(404).json({ error: "unknown_action", action: name ?? null });
  }
  return route(req, res);
}
