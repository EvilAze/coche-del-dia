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

  // ── `Vary: Origin` VA SIEMPRE, TAMBIÉN CUANDO NO PONEMOS CORS ─────────────
  // Estaba DENTRO del `if` de abajo, y esa sola línea mal colocada es la que
  // rompía el cupón de la app cada pocos minutos:
  //
  //   1. Un usuario de WEB pide /api/list-cars. Es same-origin, así que no manda
  //      `Origin` → no entramos en el `if` → la respuesta sale sin ACAO y, lo
  //      importante, TAMPOCO sin `Vary`.
  //   2. El CDN de Vercel la cachea (list-cars pide s-maxage=300). Sin `Vary`,
  //      la clave de caché IGNORA el Origin: hay UN solo objeto para todos.
  //   3. Un usuario de APP pide lo mismo (Origin: https://localhost) y el CDN le
  //      sirve esa copia, que no lleva `Access-Control-Allow-Origin`. El WebView
  //      la bloquea y `fetch` rechaza.
  //   4. Los tres intentos de src/data/catalog.js pegan contra el MISMO objeto
  //      cacheado, así que fallan los tres: «No ha llegado el listado de marcas».
  //   5. A los 5 minutos caduca. Si el siguiente relleno lo hace la app, va bien
  //      — hasta el siguiente relleno desde web. De ahí que pareciera cosa de la
  //      red y que «al rato funcionara solo»: la lotería la echaba el CDN, no la
  //      cobertura.
  //
  // La respuesta DEPENDE del Origin (a veces lleva ACAO y a veces no), así que
  // tiene que declararlo siempre — incluido el caso en que la variación consiste
  // justo en omitir la cabecera. Que es el caso que se nos escapó.
  //
  // El Edge Network de Vercel respeta `Vary` en la clave de caché (lo documentan
  // con el ejemplo de caché por país, `Vary: X-Vercel-IP-Country` junto a
  // `s-maxage`), así que con esto pasan a convivir dos objetos —el de la web y
  // el de la app— y ninguno pisa al otro.
  //
  // Afecta a los DOS endpoints que combinan `applyCors` con caché de CDN:
  // list-cars (s-maxage=300) y daily-stats (s-maxage=30 + swr=300). El resto no
  // se cachean, así que ahí esta línea es inocua. `daily-image` y `car-image` no
  // usan `applyCors`, y por eso la fotografía SÍ cargaba mientras el cupón no.
  res.setHeader("Vary", "Origin");

  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
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
