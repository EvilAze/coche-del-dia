// api/_lib/http.js
// Utilidades HTTP comunes para los endpoints de Vercel.
//
// - parseBody: Vercel pasa el body como Buffer, string o object dependiendo
//   del Content-Type. Este helper unifica el acceso al body como objeto JS.
// - methodGuard: corta la petición con 405 si el método no está permitido,
//   añadiendo el header Allow correctamente.
// - applyCors: aplica CORS para la app Android (origen https://localhost).

import { isAllowedOrigin, CORS_ALLOW_HEADERS, CORS_ALLOW_METHODS } from "./cors.js";

/**
 * Normaliza el body de la petición a objeto JS. Acepta Buffer, string
 * o ya-objeto. Devuelve {} si no hay body o no se puede parsear.
 *
 * @param {import("@vercel/node").VercelRequest} req
 * @returns {Record<string, any>}
 */
export function parseBody(req) {
  const raw = req?.body;
  if (raw == null) return {};
  if (typeof raw === "object" && !Buffer.isBuffer(raw)) return raw;
  if (Buffer.isBuffer(raw)) {
    try { return JSON.parse(raw.toString("utf8")); } catch { return {}; }
  }
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}

/**
 * Si el método no es uno de los permitidos, escribe 405 con el header
 * Allow correcto y devuelve true (el handler debe `return` inmediatamente).
 * Si el método es permitido, devuelve false y el handler continúa.
 *
 * @param {import("@vercel/node").VercelRequest} req
 * @param {import("@vercel/node").VercelResponse} res
 * @param {string | string[]} allowed Métodos permitidos, e.g. "POST" o ["GET", "HEAD"].
 * @returns {boolean} true si ya se ha respondido con 405; false en otro caso.
 */
export function methodGuard(req, res, allowed) {
  const list = Array.isArray(allowed) ? allowed : [allowed];
  if (!list.includes(req.method)) {
    res.setHeader("Allow", list.join(", "));
    res.status(405).json({ error: "Method not allowed" });
    return true;
  }
  return false;
}

/**
 * Aplica CORS para la app Android (origen https://localhost). En web
 * (same-origin) el Origin no está en la allowlist → no añade nada. Llamar
 * ANTES de methodGuard. Devuelve true si ya respondió el preflight OPTIONS
 * (el handler debe `return` inmediatamente).
 *
 * @param {import("@vercel/node").VercelRequest} req
 * @param {import("@vercel/node").VercelResponse} res
 * @returns {boolean}
 */
export function applyCors(req, res) {
  const origin = req?.headers?.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
    res.setHeader("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
  }
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}
