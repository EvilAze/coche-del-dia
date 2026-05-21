// api/_lib/supabase.js
// Fábrica central de clientes Supabase server-side. Tres usos distintos:
//
//   1. supabaseAdmin: cliente con SERVICE_ROLE_KEY — salta RLS. Para
//      cualquier operación administrativa o de lectura privilegiada
//      (cars, daily_cars, pick_daily_car, stats con upserts).
//   2. createAuthClient(token): cliente con el JWT del usuario — RLS
//      respetada. Para leer/escribir filas del propio usuario
//      (user_guesses con auth.uid()=user_id).
//   3. SUPABASE_URL / SUPABASE_ANON_KEY exportadas por si algún endpoint
//      necesita instanciar a mano (raro — preferir las dos funciones).
//
// Lectura de envs: aceptamos tanto SUPABASE_* como REACT_APP_SUPABASE_*
// por compatibilidad con la config heredada de CRA. En Vercel basta con
// definir SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
export const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
export const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Cliente con service_role (salta RLS). Singleton: una sola instancia
 * por proceso, reusada entre invocaciones cálidas de la función.
 * `null` si faltan envs — el handler debe responder 500 en ese caso.
 */
export const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

/**
 * Cliente anónimo (sin bearer). Para lecturas públicas que respetan RLS
 * pero no necesitan identidad — p.ej. listar el catálogo público.
 * Singleton también.
 */
export const supabasePublic =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

/**
 * Crea un cliente Supabase con el JWT del usuario adjunto. Las queries
 * que haga este cliente cumplen RLS bajo el rol "authenticated".
 *
 * NO se memoiza (cada petición trae su propio token).
 *
 * @param {string} accessToken JWT del usuario (sin el prefijo "Bearer ").
 */
export function createAuthClient(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
