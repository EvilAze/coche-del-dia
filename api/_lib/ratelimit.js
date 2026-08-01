// api/_lib/ratelimit.js
// Rate limit DISTRIBUIDO con Upstash Redis (REST, edge-safe) + los dos
// extractores de IP del cliente (Node y Edge), que es lo que se usa como key.
//
// Antes esto vivía en DOS ficheros con el mismo nombre a un guion de distancia
// (`rate-limit.js` y `ratelimit.js`). El primero llegó a tener un Map en
// memoria por instancia; cuando el limiter pasó a Upstash se quedó con un solo
// helper —getClientIp— y el par de nombres solo servía para importar el que no
// era. Un limiter compartido entre todas las instancias y runtimes es lo que
// impide que un bot se lo salte rotando entre instancias warm.
//
// FAIL-OPEN: si faltan las envs de Upstash, o Upstash cae/tarda/sin cuota,
// dejamos pasar la petición. El juego nunca se rompe por el limiter (regla
// "no degradar"). El precio es que durante una caída de Upstash no hay
// protección — trade-off aceptado en el diseño.
//
// Edge-safe: solo importa @upstash (compatible con Edge) y usa process.env;
// sin dependencias node-only, para poder usarse desde get-daily-car (Edge).

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Cliente Redis memoizado. _resolved evita reintentar la lectura de envs en
// cada petición de una instancia warm.
let _redis;
let _redisResolved = false;
// Caché de instancias Ratelimit por config: la librería liga el límite a la
// instancia, así que una por (prefix,max,windowSec).
const _limiters = new Map();

function getRedis() {
  if (_redisResolved) return _redis;
  _redisResolved = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

function getLimiter({ max, windowSec, prefix }) {
  const redis = getRedis();
  if (!redis) return null; // sin Upstash → checkRateLimit hará fail-open
  const cacheKey = `${prefix}:${max}:${windowSec}`;
  let limiter = _limiters.get(cacheKey);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      // Ventana deslizante: max hits por windowSec segundos.
      limiter: Ratelimit.slidingWindow(max, `${windowSec} s`),
      // prefix namespacea las keys en Redis (gdc:* vs vg:*).
      prefix,
      // analytics OFF: gastaría comandos extra de Upstash sin aportarnos nada.
      analytics: false,
    });
    _limiters.set(cacheKey, limiter);
  }
  return limiter;
}

/**
 * Lógica PURA de decisión, separada para testear sin Upstash ni red.
 * @param {{ limit: (key:string)=>Promise<{success:boolean,reset:number}> }|null} limiter
 * @param {string} key
 * @returns {Promise<{ ok: boolean, retryAfter?: number }>}
 */
export async function evaluateLimit(limiter, key) {
  try {
    if (!limiter) return { ok: true }; // sin Upstash configurado → fail-open
    const res = await limiter.limit(key);
    if (res.success) return { ok: true };
    // reset es timestamp ms del fin de ventana; lo damos en segundos (mín 1).
    const retryAfter = Math.max(1, Math.ceil((res.reset - Date.now()) / 1000));
    return { ok: false, retryAfter };
  } catch (err) {
    // Upstash caído/lento/sin cuota: no rompemos el juego.
    console.error("[ratelimit] fallo, fail-open:", err?.message || err);
    return { ok: true };
  }
}

/**
 * Comprueba el rate limit para `key` (típicamente la IP). Fail-open.
 * @param {string} key
 * @param {{ max:number, windowSec:number, prefix:string }} opts
 * @returns {Promise<{ ok: boolean, retryAfter?: number }>}
 */
export async function checkRateLimit(key, { max, windowSec, prefix }) {
  if (typeof globalThis !== "undefined" && globalThis.__mockRateLimit) {
    return globalThis.__mockRateLimit(key, { max, windowSec, prefix });
  }
  return evaluateLimit(getLimiter({ max, windowSec, prefix }), key);
}

/**
 * IP del cliente en un handler Node (Vercel Functions). La usan daily-image y
 * repesca como key del limiter y para la auditoría.
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
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
 * IP del cliente desde un Request de Edge (no hay req.socket como en Node).
 * @param {Request} request
 * @returns {string}
 */
export function getClientIpEdge(request) {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
