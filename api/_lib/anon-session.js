// api/_lib/anon-session.js
// Token firmado con HMAC-SHA256 que tracea el estado del jugador ANÓNIMO del
// coche del día. Antes era una cookie HttpOnly; ahora viaja en localStorage
// del cliente + header `X-Anon-Session`, y el servidor lo devuelve actualizado
// en el body de get-daily-car / validate-guess.
//
// Por qué el cambio: la app Android (Capacitor, origen https://localhost) habla
// con la API en cochedeldia.com → una cookie sería third-party (el WebView no
// las acepta y Chromium las retira). Un token en header no depende del origen y
// mantiene la MISMA garantía anti-trampa: la firma es server-side, el cliente no
// puede bajar `n` ni cambiar `s`.
//
// Contenido firmado: { d: "YYYY-MM-DD", n: 0..5, s: "playing"|"won"|"lost" }
//
// Nota de seguridad: a diferencia de la cookie HttpOnly, el token es legible por
// JS (localStorage). Riesgo acotado: solo gobierna el conteo de intentos de un
// día y sigue siendo infalsificable. Mismo patrón que los reveal/repesca tokens.

import crypto from "crypto";

const SECRET = process.env.REPESCA_TOKEN_SECRET || "";
// En Node, req.headers llega siempre en minúsculas.
export const ANON_HEADER_NAME = "x-anon-session";

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
 * Lee y verifica el token de sesión anónima del header X-Anon-Session.
 * Devuelve el payload `{d, n, s}` o null.
 */
export function readAnonToken(req) {
  // El cliente envía `X-Anon-Session`; Node lo normaliza a minúsculas. Si
  // llega ausente o como array (cabecera duplicada), no es un token → null.
  const raw = req?.headers?.[ANON_HEADER_NAME];
  if (typeof raw !== "string") return null;
  return verifyAnonSession(raw);
}
