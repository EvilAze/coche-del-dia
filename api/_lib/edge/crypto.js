// api/_lib/edge/crypto.js
// Helpers criptográficos que funcionan en el Edge Runtime de Vercel
// (que NO tiene `node:crypto` ni `Buffer`). Equivalentes a las primitivas
// que usan los `_lib/*` "Node" hermanos, pero implementadas con Web Crypto
// (`crypto.subtle`) y TextEncoder/TextDecoder.
//
// Por qué viven en `_lib/edge/` y no se unifican con los Node helpers:
//   - Web Crypto es ASÍNCRONO. Los Node helpers son sync.
//   - Convertir los Node helpers a async cascadea awaits por todos los
//     endpoints serverless (validate-guess, daily-image, repesca/*) y
//     obliga a re-testarlos. Para una optimización quirúrgica del
//     endpoint del primer paint, no compensa.
//   - Aquí vive lo mínimo viable para que get-daily-car arranque en Edge.
//     Si en el futuro migras más endpoints, puedes seguir importando de
//     este módulo.

const enc = new TextEncoder();

// ---------- base64url ----------------------------------------------------
// Equivalente a Buffer.from(...).toString("base64url"). Web Crypto devuelve
// ArrayBuffer; el atob/btoa nativo solo habla con strings ASCII, así que
// hacemos el round-trip a string binario antes de codificar.

export function b64urlEncodeBytes(bytes) {
  let bin = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function b64urlEncodeString(str) {
  return b64urlEncodeBytes(enc.encode(str));
}

export function b64urlDecodeToBytes(str) {
  // Rellenamos con `=` hasta múltiplo de 4 antes de atob.
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64urlDecodeToString(str) {
  return new TextDecoder().decode(b64urlDecodeToBytes(str));
}

// ---------- HMAC-SHA256 --------------------------------------------------
// Cachea la CryptoKey por (algoritmo, raw key) — importar la key es la
// parte más cara de Web Crypto y la repetimos en cada request.

const _keyCache = new Map();

async function importHmacKey(secret) {
  if (_keyCache.has(secret)) return _keyCache.get(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  _keyCache.set(secret, key);
  return key;
}

/**
 * Devuelve el HMAC-SHA256 del `body` con la `secret` clave, codificado en
 * base64url. Equivalente a:
 *   crypto.createHmac("sha256", secret).update(body).digest("base64url")
 */
export async function hmacSha256Base64Url(secret, body) {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return b64urlEncodeBytes(new Uint8Array(sig));
}

// ---------- SHA-1 (cache-buster) -----------------------------------------
// Solo lo usa get-daily-car para el hash corto que invalida el CDN cache
// cuando admin reemplaza la foto. No es uso criptográfico — un sha1
// truncado es perfecto para "ha cambiado el contenido".

export async function sha1Hex(input) {
  const buf = await crypto.subtle.digest("SHA-1", enc.encode(input));
  const arr = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, "0");
  }
  return hex;
}

// ---------- timingSafeEqual ----------------------------------------------
// Sin equivalente directo en Web Crypto. Hacemos XOR acumulado sobre dos
// Uint8Array del mismo tamaño. Mismas garantías que crypto.timingSafeEqual.

export function timingSafeEqualBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}
