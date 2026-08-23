// api/_lib/jwks.js
// Claves públicas con las que Supabase firma los JWT de sesión, cacheadas a
// nivel de MÓDULO (no de cliente). Edge-safe: solo fetch y process.env.
//
// POR QUÉ EXISTE ESTE FICHERO Y NO SE USA LA CACHÉ DE LA LIBRERÍA.
// `getClaims()` sabe cachear el JWKS, pero lo guarda en la INSTANCIA del
// cliente (`this.jwks` / `this.jwks_cached_at`), y nosotros creamos un cliente
// nuevo por petición a propósito —`createAuthClient` no se memoiza porque cada
// petición trae su propio token—. Con eso, la caché nace vacía en cada
// invocación y `getClaims` acabaría pidiendo el JWKS por red CADA VEZ: justo
// el viaje que veníamos a quitar, mudado de endpoint.
//
// `fetchJwk(kid, jwks)` mira primero las claves que se le pasan, así que
// cacheando aquí y suministrándolas por `options.keys` la verificación queda
// 100% local mientras la caché esté caliente.
//
// El módulo sobrevive entre invocaciones de una instancia warm, que es donde
// está la ganancia: una lectura del JWKS por instancia y hora, no por petición.

import { conTimeout } from "./timeout.js";

// 1 hora. Las claves de firma rotan muy de tarde en tarde y una rotación no
// invalida la caché de golpe: Supabase publica la clave nueva junto a la
// vieja durante la transición, y una `kid` desconocida fuerza un refresco
// (ver `necesitaRefresco`).
const TTL_MS = 60 * 60 * 1000;
// El JWKS es un JSON diminuto y el endpoint respondía en 240 ms mientras
// /auth/v1/user estaba muerto, pero el plazo va igual: la razón de ser de
// todo esto es no volver a colgarnos de una dependencia por red.
const PLAZO_MS = 3000;

let _cache = { keys: [] };
let _cacheadoEn = 0;
// Petición en vuelo, para que N peticiones concurrentes de una instancia fría
// no disparen N lecturas del JWKS.
let _enVuelo = null;

function urlJwks() {
  const base = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  return base ? `${base}/auth/v1/.well-known/jwks.json` : null;
}

async function leerJwks() {
  const url = urlJwks();
  if (!url) return null;
  const apikey = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
  const res = await conTimeout(
    fetch(url, { headers: apikey ? { apikey } : {} }),
    PLAZO_MS,
    { etiqueta: "jwks" }
  );
  if (!res.ok) throw new Error(`jwks HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json?.keys) || json.keys.length === 0) {
    throw new Error("jwks sin claves");
  }
  return json;
}

/**
 * Claves de firma vigentes. NUNCA lanza: si la lectura falla devuelve la
 * última caché buena (o `{keys: []}`, que hace que el llamante caiga al
 * camino de `getUser`). Un JWKS que no se puede refrescar no debe tumbar la
 * autenticación mientras las claves que ya tenemos sigan sirviendo.
 *
 * @param {{ kid?: string }} [opts] `kid` de la cabecera del token en curso: si
 *   no está en la caché, se fuerza un refresco aunque el TTL siga vivo (es la
 *   señal de que ha entrado una clave nueva).
 * @returns {Promise<{keys: object[]}>}
 */
export async function getJwks({ kid } = {}) {
  const ahora = Date.now();
  const caducado = _cacheadoEn + TTL_MS <= ahora;
  const desconocida = kid && !_cache.keys.some((k) => k.kid === kid);
  if (_cache.keys.length > 0 && !caducado && !desconocida) return _cache;

  // Una sola lectura en vuelo por instancia.
  if (!_enVuelo) {
    _enVuelo = leerJwks()
      .then((json) => {
        if (json) {
          _cache = json;
          _cacheadoEn = Date.now();
        }
        return _cache;
      })
      .catch((err) => {
        console.error("[jwks] no se pudo refrescar:", err?.message || err);
        // Nos quedamos con lo que hubiera: si está vacío, el llamante usará
        // getUser() y si no, seguimos verificando en local con las de antes.
        return _cache;
      })
      .finally(() => {
        _enVuelo = null;
      });
  }
  return _enVuelo;
}

// Solo para tests: devuelve la caché a su estado inicial.
export function _resetJwksCache() {
  _cache = { keys: [] };
  _cacheadoEn = 0;
  _enVuelo = null;
}
