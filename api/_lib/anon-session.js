// api/_lib/anon-session.js
// Cookie HttpOnly firmada con HMAC-SHA256 que tracea el estado del jugador
// ANÓNIMO del coche del día. Sustituye al `attemptNumber` que antes venía
// en el body de /api/validate-guess (campo manipulable desde el cliente,
// que permitía a un script iterar todo el catálogo con attemptNumber:1).
//
// Contenido firmado:
//   { d: "YYYY-MM-DD",   // fecha de Madrid en que se emitió
//     n: 0..5,           // intentos consumidos
//     s: "playing"|"won"|"lost" }
//
// Diseño:
//   - HMAC-SHA256 con REPESCA_TOKEN_SECRET (reutilizamos el secreto).
//   - HttpOnly + SameSite=Lax + Secure (en prod): no accesible desde JS,
//     no se filtra cross-site, no se manda en HTTP plano.
//   - Path=/ para que llegue a /api/get-daily-car y /api/validate-guess.
//   - Max-Age 24h: suficiente para una jornada; al cambiar la fecha el
//     servidor la regenera.
//
// Carpeta `_lib` (prefijo _): Vercel la excluye del routing serverless.
// Este archivo NO cuenta para el límite de 12 functions del plan Hobby.

import crypto from "crypto";

const SECRET = process.env.REPESCA_TOKEN_SECRET || "";
export const ANON_COOKIE_NAME = "cd_anon";
const MAX_AGE_SECONDS = 60 * 60 * 24; // 24 h

function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64url");
}

function b64urlDecode(str) {
  return Buffer.from(str, "base64url");
}

/**
 * Firma un payload pequeño y devuelve `<body>.<sig>` (URL-safe).
 * Lanza si el secreto no está configurado.
 */
export function signAnonSession(payload) {
  if (!SECRET) throw new Error("REPESCA_TOKEN_SECRET not configured");
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

/**
 * Verifica y parsea el token. Devuelve `null` si el secreto no está
 * configurado, si el formato es inválido, o si la firma no coincide.
 */
export function verifyAnonSession(token) {
  if (!SECRET || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(body)
    .digest("base64url");
  // Comparación constant-time para evitar timing attacks.
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
    return JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Parseo permisivo del header Cookie. Vercel no lo auto-parsea en runtimes
 * Node — hacemos un split casero, sin dependencias.
 */
export function parseCookies(req) {
  const header = req.headers?.cookie || "";
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    if (!k) continue;
    out[k] = part.slice(idx + 1).trim();
  }
  return out;
}

/**
 * Atajo: lee y verifica la cookie de sesión anónima en una sola llamada.
 * Devuelve el payload `{d, n, s}` o null.
 */
export function readAnonSession(req) {
  const cookies = parseCookies(req);
  return verifyAnonSession(cookies[ANON_COOKIE_NAME] || "");
}

/**
 * Construye el valor del header Set-Cookie para esta sesión. Marca Secure
 * salvo en desarrollo (donde localhost no usa HTTPS y el navegador la
 * rechazaría).
 */
export function buildSetCookie(payload) {
  const token = signAnonSession(payload);
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

/**
 * Helper: setea la cookie en la respuesta, preservando cualquier Set-Cookie
 * que ya estuviera (poco probable en estos endpoints, pero defensivo).
 */
export function setAnonCookie(res, payload) {
  const value = buildSetCookie(payload);
  const prev = res.getHeader("Set-Cookie");
  if (Array.isArray(prev)) {
    res.setHeader("Set-Cookie", [...prev, value]);
  } else if (prev) {
    res.setHeader("Set-Cookie", [prev, value]);
  } else {
    res.setHeader("Set-Cookie", value);
  }
}
