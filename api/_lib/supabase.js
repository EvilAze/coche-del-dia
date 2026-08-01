// api/_lib/supabase.js
// Fábrica central de clientes Supabase server-side. Tres usos distintos:
//
//   1. getSupabaseAdmin(): cliente con SERVICE_ROLE_KEY — salta RLS. Para
//      cualquier operación administrativa o de lectura privilegiada
//      (cars, daily_cars, pick_daily_car, stats con upserts).
//   2. createAuthClient(token): cliente con el JWT del usuario — RLS
//      respetada. Para leer/escribir filas del propio usuario.
//   3. getSupabasePublic(): cliente anónimo (sin bearer). Para lecturas
//      públicas que respetan RLS pero no necesitan identidad — p.ej. el
//      catálogo público (list-cars).
//
// IMPORTANTE: los clientes se crean **perezosamente** en la primera llamada,
// no al importar el módulo. Esto evita un problema real con `vercel dev`:
// si una env var llegaba al proceso después del primer import, el cliente
// se quedaba cacheado a `null` para siempre. Con lazy-init, cada handler
// pide el cliente al ejecutar y siempre vemos el `process.env` actual.
//
// Lectura de envs: aceptamos tanto SUPABASE_* como REACT_APP_SUPABASE_*
// por compatibilidad con la config heredada de CRA. En Vercel basta con
// definir SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";

function readUrl() {
  return process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || null;
}
function readAnonKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || null;
}
function readServiceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

// (Sobre estas tres lecturas había otros tres getters públicos —
// getSupabaseUrl / getSupabaseAnonKey / getSupabaseServiceRoleKey— que se
// limitaban a reenviar la llamada. Nadie los usaba: los clientes de abajo
// llaman a readX() directamente. Lo que importaba de ellos, y sigue vigente,
// es que readX() lee process.env en CADA invocación (live binding) en vez de
// cachear un snapshot al importar — ese era el bug original.)

let _adminCached;
let _adminCachedFor; // recordamos para qué URL+key se cacheó
let _publicCached;
let _publicCachedFor;

/**
 * Cliente con service_role (salta RLS). Memoizado por par (URL, key) —
 * si las env vars cambian entre invocaciones (caso típico en `vercel dev`
 * cuando se actualiza `.env.local`), se recrea automáticamente.
 *
 * Devuelve `null` si faltan envs. El handler debe responder 500 en ese
 * caso. Para diagnóstico, usa `getMissingAdminEnvs()`.
 */
export function getSupabaseAdmin() {
  const url = readUrl();
  const key = readServiceKey();
  if (!url || !key) return null;
  const fingerprint = `${url}|${key}`;
  if (_adminCachedFor === fingerprint) return _adminCached;
  _adminCached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  _adminCachedFor = fingerprint;
  return _adminCached;
}

/**
 * Devuelve la lista de env vars que faltan para que `getSupabaseAdmin()`
 * funcione. Útil para mensajes de error claros.
 */
export function getMissingAdminEnvs() {
  const missing = [];
  if (!readUrl()) missing.push("SUPABASE_URL");
  if (!readServiceKey()) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return missing;
}

/**
 * Cliente anónimo (sin bearer). Memoizado igual que el admin.
 */
export function getSupabasePublic() {
  const url = readUrl();
  const key = readAnonKey();
  if (!url || !key) return null;
  const fingerprint = `${url}|${key}`;
  if (_publicCachedFor === fingerprint) return _publicCached;
  _publicCached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  _publicCachedFor = fingerprint;
  return _publicCached;
}

export function getMissingPublicEnvs() {
  const missing = [];
  if (!readUrl()) missing.push("SUPABASE_URL");
  if (!readAnonKey()) missing.push("SUPABASE_ANON_KEY");
  return missing;
}

/**
 * Crea un cliente Supabase con el JWT del usuario adjunto. Las queries
 * que haga este cliente cumplen RLS bajo el rol "authenticated".
 *
 * NO se memoiza (cada petición trae su propio token).
 *
 * @param {string} accessToken JWT del usuario (sin el prefijo "Bearer ").
 */
export function createAuthClient(accessToken) {
  const url = readUrl();
  const anonKey = readAnonKey();
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
