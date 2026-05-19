// api/_lib/reveal-token.js
// Token corto firmado con HMAC que permite ver la imagen COMPLETA del coche
// del día sin filtrar el cars.id ni la URL original del CDN.
//
// El token contiene únicamente la fecha (YYYY-MM-DD). El servidor lo emite
// desde /api/get-daily-car o /api/validate-guess cuando puede certificar
// que el portador tiene derecho a ver la imagen entera (ganó/perdió). El
// frontend lo añade como `?t=<token>` a /api/daily-image.
//
// Reflexión sobre la seguridad:
//   - Como el token solo dice "es hoy", quien lo tenga lo puede compartir.
//     Equivalente a que un ganador comparta un screenshot — el filtrado de
//     información ya ocurrió en el momento de ganar. No empeora.
//   - Antes de este token, cualquier visitante podía quitar `&z=5` de la
//     URL y ver la imagen completa. Era PEOR.
//
// Carpeta `_lib`: excluida del routing serverless de Vercel.

import crypto from "crypto";

const SECRET = process.env.REPESCA_TOKEN_SECRET || "";

function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64url");
}

function b64urlDecode(str) {
  return Buffer.from(str, "base64url");
}

/**
 * Firma un token de reveal para una fecha. Devuelve `<date>.<sig>`.
 * Lanza si el secreto no está configurado (preferimos romper en deploy
 * a servir tokens vacíos).
 */
export function signRevealToken(date) {
  if (!SECRET) throw new Error("REPESCA_TOKEN_SECRET not configured");
  if (typeof date !== "string" || !date) {
    throw new Error("signRevealToken: invalid date");
  }
  const body = b64urlEncode(date);
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

/**
 * Verifica el token y devuelve la fecha que contiene, o null si:
 *   - Falta secreto
 *   - Formato inválido
 *   - Firma no coincide (timing-safe)
 *
 * El caller decide si esa fecha es válida para hoy (típicamente compara
 * contra todayInMadrid()).
 */
export function verifyRevealToken(token) {
  if (!SECRET || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(body)
    .digest("base64url");
  let a, b;
  try {
    a = b64urlDecode(sig);
    b = b64urlDecode(expected);
  } catch {
    return null;
  }
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    return b64urlDecode(body).toString("utf8");
  } catch {
    return null;
  }
}
