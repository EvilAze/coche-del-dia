// api/_lib/edge/anon-session.js
// Versión Edge-runtime del token de sesión anónima (api/_lib/anon-session.js).
// Mismo formato de wire que la versión Node, así que tokens firmados por una
// los verifica la otra. Diferencias: firma/verificación con Web Crypto
// (asíncrono) y lectura desde `Request` (Fetch API).

import {
  b64urlEncodeString,
  b64urlDecodeToBytes,
  b64urlDecodeToString,
  hmacSha256Base64Url,
  timingSafeEqualBytes,
} from "./crypto.js";

const SECRET = () => process.env.REPESCA_TOKEN_SECRET || "";
// Mismo nombre lógico que en Node; Request.headers.get() es case-insensitive.
export const ANON_HEADER_NAME = "x-anon-session";

/**
 * Firma `{d, n, s}` y devuelve `<body>.<sig>` (URL-safe).
 * Lanza si el secreto no está configurado.
 */
export async function signAnonSession(payload) {
  const secret = SECRET();
  if (!secret) throw new Error("REPESCA_TOKEN_SECRET not configured");
  const body = b64urlEncodeString(JSON.stringify(payload));
  const sig = await hmacSha256Base64Url(secret, body);
  return `${body}.${sig}`;
}

/**
 * Verifica y parsea el token. Devuelve null si el secreto no está configurado,
 * si el formato es inválido, o si la firma no coincide.
 */
export async function verifyAnonSession(token) {
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
    return JSON.parse(b64urlDecodeToString(body));
  } catch {
    return null;
  }
}

/**
 * Lee y verifica el token de sesión anónima del header X-Anon-Session de un
 * Request (Fetch API). Devuelve el payload `{d, n, s}` o null.
 */
export async function readAnonTokenFromRequest(request) {
  const raw = request.headers.get(ANON_HEADER_NAME) || "";
  return await verifyAnonSession(raw);
}
