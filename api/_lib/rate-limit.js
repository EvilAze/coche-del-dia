// api/_lib/rate-limit.js
// Rate-limit en memoria por IP. Best-effort: cada instancia warm de la
// función Vercel mantiene su propio Map, así que un cheater que tenga la
// suerte de caer en una instancia distinta puede saltarse el límite. Sirve
// para parar scripts triviales sin sumar dependencias (Upstash, KV) ni
// salirnos del plan Hobby.
//
// Si en el futuro la trampa pasa de "script casero" a "ataque coordinado",
// la solución correcta es @upstash/ratelimit + Vercel KV. Para una web
// pequeña como esta es matar moscas a cañonazos.
//
// Carpeta `_lib`: excluida del routing serverless de Vercel.

const buckets = new Map();
const MAX_BUCKET_SIZE = 5000; // techo de memoria, GC perezoso por encima

export function getClientIp(req) {
  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff) {
    return xff.split(",")[0].trim();
  }
  if (Array.isArray(xff) && xff.length) {
    return String(xff[0]).split(",")[0].trim();
  }
  const real = req.headers?.["x-real-ip"];
  if (typeof real === "string" && real) return real;
  return req.socket?.remoteAddress || "unknown";
}

/**
 * Cuenta una hit y devuelve si pasa el límite.
 *
 *   max      → hits permitidos en la ventana (default: 30)
 *   windowMs → tamaño de la ventana (default: 60 000 ms = 1 minuto)
 *   key      → identificador (típicamente IP, o IP + ruta)
 */
export function rateLimit(key, { max = 30, windowMs = 60_000 } = {}) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;

  // GC perezoso: si el Map crece demasiado, limpiamos buckets expirados.
  // Mejor pagar O(N) muy de vez en cuando que tener fuga de memoria en
  // una función serverless que puede estar warm horas.
  if (buckets.size > MAX_BUCKET_SIZE) {
    for (const [k, v] of buckets) {
      if (v.resetAt <= now) buckets.delete(k);
    }
  }

  return {
    ok: b.count <= max,
    remaining: Math.max(0, max - b.count),
    resetAt: b.resetAt,
  };
}
