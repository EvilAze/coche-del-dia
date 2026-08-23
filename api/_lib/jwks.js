// api/_lib/jwks.js
// Claves públicas con las que Supabase firma los JWT de sesión. Es lo que
// permite verificar la identidad SIN preguntarle a GoTrue en cada petición.
//
// TRES NIVELES, y el orden importa:
//   L1  memoria del módulo   — instantáneo, por instancia.
//   L2  Upstash Redis        — compartido entre instancias y, sobre todo,
//                              SOBREVIVE A UNA CAÍDA DE GOTRUE.
//   L3  el endpoint JWKS     — la fuente, pero la sirve el propio GoTrue.
//
// POR QUÉ L2 NO ES UN LUJO. La primera versión de esto solo tenía L1 y L3, y
// se estrelló en producción el 23 de agosto de 2026 de una forma que conviene
// no olvidar: `/auth/v1/.well-known/jwks.json` lo sirve el MISMO servicio que
// estaba atrancado, así que una instancia que arrancaba en frío durante la
// caída no podía conseguir las claves, se caía al respaldo `getUser()` —que
// también estaba muerto— y devolvía 503. Verificar en local no sirve de nada
// si para poder verificar hay que llamar antes a quien no contesta.
//
// Con L2, basta UNA lectura exitosa en toda la flota para que la verificación
// siga funcionando aunque GoTrue esté caído durante días. Y Upstash es una
// dependencia distinta: el 23 de agosto estuvo en pie todo el rato, sirviendo
// el rate-limit sin un fallo.
//
// POR QUÉ NO VALE LA CACHÉ DE LA LIBRERÍA. `getClaims()` sabe cachear el JWKS,
// pero lo guarda en la INSTANCIA del cliente, y `createAuthClient` crea una por
// petición a propósito. Con eso la caché nace vacía cada vez y `getClaims`
// pediría el JWKS por red SIEMPRE. `fetchJwk(kid, jwks)` mira primero las
// claves que se le pasan, así que suministrándolas nosotros la verificación es
// local de verdad.

import { conTimeout } from "./timeout.js";
import { getRedis } from "./ratelimit.js";

// TTL de la caché en memoria. Las claves rotan muy de tarde en tarde y una
// rotación no invalida esto de golpe: Supabase publica la nueva junto a la
// vieja durante la transición, y un `kid` desconocido fuerza refresco.
const TTL_MS = 60 * 60 * 1000;
// En Redis viven mucho más: su valor es precisamente estar ahí cuando la
// fuente no está. 30 días.
const TTL_REDIS_S = 30 * 24 * 60 * 60;
const CLAVE_REDIS = "jwks:v1";
const PLAZO_MS = 5000;
// Tras un fallo, no se vuelve a intentar durante este rato. Sin esto, con
// GoTrue caído CADA petición autenticada pagaba el plazo entero del fetch
// antes de caer al respaldo — latencia añadida a un usuario que ya lo estaba
// pasando mal.
const ESPERA_TRAS_FALLO_MS = 60 * 1000;

let _cache = { keys: [] };
let _cacheadoEn = 0;
let _falloEn = 0;
let _enVuelo = null;

function urlJwks() {
  const base = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  return base ? `${base}/auth/v1/.well-known/jwks.json` : null;
}

function valido(json) {
  return Array.isArray(json?.keys) && json.keys.length > 0;
}

async function leerDeRedis() {
  try {
    const redis = getRedis();
    if (!redis) return null;
    const json = await conTimeout(redis.get(CLAVE_REDIS), 1500, { etiqueta: "jwks redis get" });
    // El SDK de Upstash ya deserializa el JSON.
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    return valido(parsed) ? parsed : null;
  } catch (err) {
    console.error("[jwks] Redis no disponible:", err?.message || err);
    return null;
  }
}

async function guardarEnRedis(json) {
  try {
    const redis = getRedis();
    if (!redis) return;
    await conTimeout(redis.set(CLAVE_REDIS, JSON.stringify(json), { ex: TTL_REDIS_S }), 1500, {
      etiqueta: "jwks redis set",
    });
  } catch (err) {
    // Que no se pueda guardar no invalida las claves que acabamos de leer.
    console.error("[jwks] no se pudo guardar en Redis:", err?.message || err);
  }
}

async function leerDelOrigen() {
  const url = urlJwks();
  if (!url) return null;
  const apikey = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
  const res = await conTimeout(fetch(url, { headers: apikey ? { apikey } : {} }), PLAZO_MS, {
    etiqueta: "jwks",
  });
  if (!res.ok) throw new Error(`jwks HTTP ${res.status}`);
  const json = await res.json();
  if (!valido(json)) throw new Error("jwks sin claves");
  return json;
}

// Refresca L1 pasando por L2 y, si hace falta, por L3. Nunca lanza.
async function refrescar() {
  // L2 primero: es la que sigue viva cuando la fuente no lo está, y además
  // es más rápida.
  const deRedis = await leerDeRedis();
  if (deRedis) {
    _cache = deRedis;
    _cacheadoEn = Date.now();
    return _cache;
  }
  // L3: la fuente. Si sale bien, se siembra L2 para toda la flota.
  try {
    const json = await leerDelOrigen();
    if (json) {
      _cache = json;
      _cacheadoEn = Date.now();
      _falloEn = 0;
      await guardarEnRedis(json);
    }
  } catch (err) {
    _falloEn = Date.now();
    console.error("[jwks] no se pudo refrescar:", err?.message || err);
  }
  return _cache;
}

/**
 * Claves de firma vigentes. NUNCA lanza: si no se pueden refrescar devuelve la
 * última caché buena, o `{keys: []}` —que hace que el llamante caiga al camino
 * de `getUser`—. Un JWKS irrefrescable no debe tumbar la autenticación
 * mientras las claves que ya tenemos sigan sirviendo.
 *
 * @param {{ kid?: string }} [opts] `kid` del token en curso: si no está en la
 *   caché se fuerza refresco aunque el TTL siga vivo (así se absorbe una
 *   rotación sin esperar una hora).
 * @returns {Promise<{keys: object[]}>}
 */
export async function getJwks({ kid } = {}) {
  const ahora = Date.now();
  const caducado = _cacheadoEn + TTL_MS <= ahora;
  const desconocida = kid && !_cache.keys.some((k) => k.kid === kid);
  if (_cache.keys.length > 0 && !caducado && !desconocida) return _cache;

  // Backoff: si acabamos de fallar, no reintentamos en cada petición. Con lo
  // que haya en L1 basta para seguir, y si L1 está vacía el llamante usará el
  // respaldo sin pagar otro plazo de red.
  if (_falloEn && ahora - _falloEn < ESPERA_TRAS_FALLO_MS) return _cache;

  // Una sola operación en vuelo por instancia: N peticiones concurrentes de
  // una instancia fría no deben disparar N lecturas.
  if (!_enVuelo) {
    _enVuelo = refrescar().finally(() => {
      _enVuelo = null;
    });
  }
  return _enVuelo;
}

// Solo para tests: devuelve la caché a su estado inicial.
export function _resetJwksCache() {
  _cache = { keys: [] };
  _cacheadoEn = 0;
  _falloEn = 0;
  _enVuelo = null;
}
