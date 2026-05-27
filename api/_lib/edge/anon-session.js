// api/_lib/edge/anon-session.js
// Versión Edge-runtime del helper de cookie HttpOnly firmada para el
// anónimo (api/_lib/anon-session.js). Mismo formato de wire que la
// versión Node, así que cookies emitidas por una las verifica la otra.
//
// Diferencias respecto a la versión Node:
//   - Firma/verificación con Web Crypto (asíncrono).
//   - `readAnonSession` toma `Request` (Fetch API) en vez de `req`
//     estilo Vercel/Express.
//   - En vez de mutar `res`, exponemos `buildSetCookie(payload)` que
//     devuelve el string del header — el handler Edge lo añade a la
//     `Response` con `headers.append("Set-Cookie", value)`.

import {
  b64urlEncodeString,
  b64urlDecodeToBytes,
  b64urlDecodeToString,
  hmacSha256Base64Url,
  timingSafeEqualBytes,
} from "./crypto.js";

const SECRET = () => process.env.REPESCA_TOKEN_SECRET || "";
export const ANON_COOKIE_NAME = "cd_anon";
const MAX_AGE_SECONDS = 60 * 60 * 24; // 24 h

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
 * Verifica y parsea el token. Devuelve null si el secreto no está
 * configurado, si el formato es inválido, o si la firma no coincide.
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
 * Parseo permisivo del header Cookie de un Request (Fetch API).
 * Devuelve un mapa name → value.
 */
export function parseCookiesFromHeader(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    if (!k) continue;
    out[k] = part.slice(idx + 1).trim();
  }
  return out;
}

/**
 * Atajo: lee y verifica la cookie de sesión anónima de un Request.
 * Devuelve el payload `{d, n, s}` o null.
 */
export async function readAnonSession(request) {
  const cookies = parseCookiesFromHeader(request.headers.get("cookie"));
  return await verifyAnonSession(cookies[ANON_COOKIE_NAME] || "");
}

/**
 * Construye el valor del header Set-Cookie para esta sesión. Marca
 * Secure salvo en desarrollo (donde localhost no usa HTTPS y el
 * navegador la rechazaría). Devuelve el string — el handler Edge lo
 * añade a la Response con `headers.append("Set-Cookie", value)`.
 */
export async function buildSetCookie(payload) {
  const token = await signAnonSession(payload);
  const flags = [
    `${ANON_COOKIE_NAME}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (process.env.NODE_ENV !== "development") flags.push("Secure");
  return flags.join("; ");
}
