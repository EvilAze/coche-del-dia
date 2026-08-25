// api/_lib/edge/reveal-token.js
// Versión Edge-runtime del helper de tokens de reveal (api/_lib/reveal-token.js).
// Mismo formato de wire (`<payload>.<sig>`, payload = `fecha` o `fecha|sello`)
// y mismo secreto, así que los tokens son interoperables: uno firmado por la
// versión Node lo verifica esta y viceversa — que es justo lo que pasa, porque
// get-daily-car firma en Edge y daily-image verifica en Node. Lo necesitamos
// por separado porque Web Crypto es asíncrono y no podemos hacer sync los
// `crypto.createHmac` originales sin cascadear awaits por todo el codebase.
//
// El porqué del sello (y no solo la fecha) está en la versión Node: resumido,
// un día ya no es un coche desde que existe el cambio de emergencia, y un
// token que solo dice «hoy» abría la foto entera del coche vigente a quien se
// había ganado otro.

import {
  b64urlEncodeString,
  b64urlDecodeToBytes,
  b64urlDecodeToString,
  hmacSha256Base64Url,
  timingSafeEqualBytes,
} from "./crypto.js";

const SECRET = () => process.env.REPESCA_TOKEN_SECRET || "";

// Mismo separador que la réplica Node. Si cambia, cambia en las dos.
const SEP = "|";

/**
 * Firma un token de reveal para una fecha y el coche del portador.
 * Devuelve `<payload>.<sig>`.
 * Lanza si el secreto no está configurado (preferimos romper en deploy
 * a servir tokens vacíos).
 *
 * @param {string} date  YYYY-MM-DD
 * @param {string|null} [sello] sello del coche RESUELTO de ese jugador.
 */
export async function signRevealToken(date, sello = null) {
  const secret = SECRET();
  if (!secret) throw new Error("REPESCA_TOKEN_SECRET not configured");
  if (typeof date !== "string" || !date) {
    throw new Error("signRevealToken: invalid date");
  }
  const body = b64urlEncodeString(sello ? `${date}${SEP}${sello}` : date);
  const sig = await hmacSha256Base64Url(secret, body);
  return `${body}.${sig}`;
}

/**
 * Verifica el token y devuelve `{ date, sello }`, o null si:
 *   - Falta secreto
 *   - Formato inválido
 *   - Firma no coincide (timing-safe)
 *
 * `sello` es null en los tokens del formato viejo. El caller decide si esa
 * fecha es válida para hoy (típicamente compara contra todayInMadrid()) y qué
 * hacer con un token sin sello.
 *
 * @returns {Promise<{date: string, sello: string|null} | null>}
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
    const payload = b64urlDecodeToString(body);
    const corte = payload.indexOf(SEP);
    if (corte < 0) return { date: payload, sello: null };
    return {
      date: payload.slice(0, corte),
      sello: payload.slice(corte + 1) || null,
    };
  } catch {
    return null;
  }
}
