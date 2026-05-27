// api/_lib/edge/reveal-token.js
// Versión Edge-runtime del helper de tokens de reveal (api/_lib/reveal-token.js).
// Mismo formato de wire (`<date>.<sig>`) y mismo secreto, así que los tokens
// son interoperables: uno firmado por la versión Node lo verifica esta y
// viceversa. Lo necesitamos por separado porque Web Crypto es asíncrono y
// no podemos hacer sync los `crypto.createHmac` originales sin cascadear
// awaits por todo el codebase.

import {
  b64urlEncodeString,
  b64urlDecodeToBytes,
  b64urlDecodeToString,
  hmacSha256Base64Url,
  timingSafeEqualBytes,
} from "./crypto.js";

const SECRET = () => process.env.REPESCA_TOKEN_SECRET || "";

/**
 * Firma un token de reveal para una fecha. Devuelve `<date>.<sig>`.
 * Lanza si el secreto no está configurado (preferimos romper en deploy
 * a servir tokens vacíos).
 */
export async function signRevealToken(date) {
  const secret = SECRET();
  if (!secret) throw new Error("REPESCA_TOKEN_SECRET not configured");
  if (typeof date !== "string" || !date) {
    throw new Error("signRevealToken: invalid date");
  }
  const body = b64urlEncodeString(date);
  const sig = await hmacSha256Base64Url(secret, body);
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
export async function verifyRevealToken(token) {
  const secret = SECRET();
  if (!secret || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmacSha256Base64Url(secret, body);
  let a, b;
  try {
    a = b64urlDecodeToBytes(sig);
    b = b64urlDecodeToBytes(expected);
  } catch {
    return null;
  }
  if (!timingSafeEqualBytes(a, b)) return null;
  try {
    return b64urlDecodeToString(body);
  } catch {
    return null;
  }
}
