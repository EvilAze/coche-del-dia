// api/_lib/reveal-token.js
// Token corto firmado con HMAC que permite ver la imagen COMPLETA del coche
// del día sin filtrar el cars.id ni la URL original del CDN.
//
// El token contiene la fecha (YYYY-MM-DD) y el SELLO del coche que su portador
// se ha ganado (api/_lib/sello.js). El servidor lo emite desde
// /api/get-daily-car o /api/validate-guess cuando puede certificar que el
// portador tiene derecho a ver la imagen entera (ganó/perdió). El frontend lo
// añade como `?t=<token>` a /api/daily-image.
//
// POR QUÉ LLEVA EL SELLO Y NO SOLO LA FECHA. Antes solo llevaba la fecha, y el
// argumento era «un día = un coche, así que el token solo abre la foto que su
// portador ya se había ganado». Con el cambio de emergencia del coche del día
// eso dejó de ser cierto: un jugador congelado en el coche A termina su
// partida, recibe su token de hoy, abre la web en incógnito —donde
// get-daily-car le da la URL del coche VIGENTE (B)— y presenta su token contra
// esa URL. Con un token que solo dice «hoy», eso abría la foto entera de B, el
// coche que todos los demás siguen jugando (regla 5). El sello ata el token a
// SU revisión: es opaco (HMAC, no dice qué coche es) y daily-image exige que
// corresponda al coche que ha resuelto por el `v` de la URL.
//
// Reflexión sobre la seguridad:
//   - Como el token dice «es hoy y es ESTE coche», quien lo tenga lo puede
//     compartir con quien juegue esa misma revisión. Equivalente a que un
//     ganador comparta un screenshot — el filtrado de información ya ocurrió
//     en el momento de ganar. No empeora.
//   - Antes de este token, cualquier visitante podía quitar `&z=5` de la
//     URL y ver la imagen completa. Era PEOR.
//
// Réplica Edge en ./edge/reveal-token.js: MISMO formato de wire (uno firma en
// Edge y el otro verifica en Node). Si tocas el payload, tócalo en las dos.
//
// Carpeta `_lib`: excluida del routing serverless de Vercel.

import crypto from "crypto";

// Perezoso (función, no `const` al importar): mismo motivo que en
// anon-session.js — leer el env arriba congelaría un secreto vacío si
// REPESCA_TOKEN_SECRET llega después del import, y a partir de ahí toda firma
// fallaría sin que nada lo explique.
const SECRET = () => process.env.REPESCA_TOKEN_SECRET || "";

// Separador del payload firmado. El sello es base64url (16 chars) y la fecha
// es YYYY-MM-DD, así que `|` no aparece en ninguno de los dos y el split por el
// PRIMER separador es inequívoco.
const SEP = "|";

function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64url");
}

function b64urlDecode(str) {
  return Buffer.from(str, "base64url");
}

/**
 * Firma un token de reveal para una fecha y el coche del portador.
 * Devuelve `<payload>.<sig>`.
 * Lanza si el secreto no está configurado (preferimos romper en deploy
 * a servir tokens vacíos).
 *
 * @param {string} date  YYYY-MM-DD
 * @param {string|null} [sello] sello del coche RESUELTO de ese jugador. Sin él
 *   el token sale en el formato viejo, que solo abre los días sin salientes.
 */
export function signRevealToken(date, sello = null) {
  const secret = SECRET();
  if (!secret) throw new Error("REPESCA_TOKEN_SECRET not configured");
  if (typeof date !== "string" || !date) {
    throw new Error("signRevealToken: invalid date");
  }
  const payload = sello ? `${date}${SEP}${sello}` : date;
  const body = b64urlEncode(payload);
  const sig = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

/**
 * Verifica el token y devuelve `{ date, sello }`, o null si:
 *   - Falta secreto
 *   - Formato inválido
 *   - Firma no coincide (timing-safe)
 *
 * `sello` es null en los tokens del formato viejo (los que ya circulaban
 * cuando esto solo llevaba la fecha). El caller decide qué hacer con ellos y
 * si la fecha vale para hoy (típicamente compara contra todayInMadrid()).
 *
 * @returns {{date: string, sello: string|null} | null}
 */
export function verifyRevealToken(token) {
  const secret = SECRET();
  if (!secret || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto
    .createHmac("sha256", secret)
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
    const payload = b64urlDecode(body).toString("utf8");
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
