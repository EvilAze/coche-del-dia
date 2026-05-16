// api/_lib/image-token.js
// Token opaco para servir imágenes del garaje a través del proxy
// /api/car-image. Cifra (no solo firma) el par (carId, mode) con AES-256-GCM,
// usando como llave el SHA-256 de REPESCA_TOKEN_SECRET.
//
// ¿Por qué cifrar y no solo firmar HMAC?
//   - El <img> tag llevará este token en la URL. Si firmáramos en claro
//     (?c=<carId>&m=blurred&s=<sig>), un atacante leería el carId real
//     desde DevTools y lo cruzaría con /api/list-cars → adiós misterio.
//   - Con AES-GCM el carId queda ilegible y el auth-tag previene flipping
//     de bits (no se puede cambiar mode=blurred por mode=clear).
//
// IV determinista (SHA-256 del payload truncado a 12 bytes): mismo input
// produce mismo token, así el navegador puede cachear las imágenes por URL
// entre renders del Garaje. La pérdida teórica de seguridad semántica no
// importa: el contenido cifrado es público por diseño (el usuario ya lo
// recibió en su garaje).
//
// Carpeta `_lib`: prefijada con `_`, Vercel la excluye del routing
// serverless. No se publica como endpoint.

import crypto from "crypto";

const RAW_SECRET = process.env.REPESCA_TOKEN_SECRET || "";
const KEY = RAW_SECRET
  ? crypto.createHash("sha256").update(RAW_SECRET).digest()
  : null;
const ALGO = "aes-256-gcm";

export const IMAGE_MODE_CLEAR = "c";
export const IMAGE_MODE_BLURRED = "b";

/**
 * Cifra (carId, mode) en un token URL-safe.
 * mode: "c" (clear → redirect a Supabase) o "b" (blurred → JPEG procesado).
 *
 * Lanza si REPESCA_TOKEN_SECRET no está configurado: preferimos fallar
 * ruidosamente a servir tokens con clave vacía.
 */
export function signImageToken({ carId, mode }) {
  if (!KEY) throw new Error("REPESCA_TOKEN_SECRET not configured");
  if (!carId || !mode) throw new Error("signImageToken: missing fields");
  if (mode !== IMAGE_MODE_CLEAR && mode !== IMAGE_MODE_BLURRED) {
    throw new Error(`signImageToken: invalid mode "${mode}"`);
  }
  const payload = `${carId}|${mode}`;
  // IV determinista — ver cabecera del archivo.
  const iv = crypto
    .createHash("sha256")
    .update(`iv:${payload}`)
    .digest()
    .subarray(0, 12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([
    cipher.update(payload, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

/**
 * Descifra y valida un token. Devuelve { carId, mode } o null si el token
 * es inválido, ha sido alterado, o el secreto no está configurado.
 */
export function verifyImageToken(token) {
  if (!KEY) return null;
  if (typeof token !== "string" || token.length === 0) return null;
  try {
    const buf = Buffer.from(token, "base64url");
    // 12 (iv) + 16 (tag) + al menos 1 byte de payload.
    if (buf.length < 12 + 16 + 1) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
    decipher.setAuthTag(tag);
    const decoded = Buffer.concat([
      decipher.update(enc),
      decipher.final(),
    ]).toString("utf8");
    const sep = decoded.lastIndexOf("|");
    if (sep <= 0) return null;
    const carId = decoded.slice(0, sep);
    const mode = decoded.slice(sep + 1);
    if (!carId) return null;
    if (mode !== IMAGE_MODE_CLEAR && mode !== IMAGE_MODE_BLURRED) return null;
    return { carId, mode };
  } catch {
    return null;
  }
}
