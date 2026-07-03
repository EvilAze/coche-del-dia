// api/repesca/[...action].js
// Catch-all que agrupa los endpoints de la repesca en UNA sola Serverless
// Function (mismo patrón que api/cron/[...job].js y api/admin/[...slug].js),
// para dejar margen bajo el límite de 12 funciones del plan Hobby. La lógica
// vive en api/_lib/repesca/ (prefijo _ → Vercel NO la cuenta).
//   · /api/repesca/image    → image (proxy de la foto desenfocada)
//   · /api/repesca/start    → start
//   · /api/repesca/validate → validate
// Cada handler conserva su propia auth/CORS/validación de método.

import image from "../_lib/repesca/image.js";
import start from "../_lib/repesca/start.js";
import validate from "../_lib/repesca/validate.js";

const ROUTES = { image, start, validate };

export default async function handler(req, res) {
  // Vercel a veces NO puebla req.query.action en un catch-all (verificado en
  // prod con api/cron/[...job].js) → fallback: parseamos el segmento de req.url.
  const raw = req.query.action;
  let name;
  if (Array.isArray(raw)) name = raw.join("/");
  else if (typeof raw === "string" && raw.length > 0) name = raw;
  else if (req.url) {
    const path = req.url.split("?")[0];
    const m = path.match(/^\/api\/repesca\/(.+?)\/?$/);
    if (m) name = m[1];
  }

  const route = ROUTES[name];
  if (!route) {
    return res.status(404).json({ error: "unknown_action", action: name ?? null });
  }
  return route(req, res);
}
