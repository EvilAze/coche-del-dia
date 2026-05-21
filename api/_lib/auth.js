// api/_lib/auth.js
// Helpers centrales de autenticación para los endpoints serverless.
//
// Flujo estándar para un endpoint autenticado:
//
//   import { requireUser } from "./_lib/auth.js";
//   const { user, authClient, error } = await requireUser(req);
//   if (error) return res.status(error.status).json({ error: error.message });
//   // ... operaciones autenticadas con authClient ...
//
// Y si además quieres restringir a admin:
//
//   const { user, authClient, error } = await requireAdmin(req);
//   ...

import { createAuthClient } from "./supabase.js";

// Whitelist de emails con permisos de admin. Lo dejamos en código (no
// env var) para evitar misconfiguración silenciosa: si quieres añadir
// o quitar un admin, lo ves en un PR y queda auditado en git.
export const ADMIN_EMAILS = ["ievilaze@gmail.com"];

/**
 * Extrae el JWT del header Authorization: "Bearer <token>".
 * Devuelve null si no hay header válido.
 *
 * @param {import("@vercel/node").VercelRequest} req
 * @returns {string | null}
 */
export function extractAccessToken(req) {
  const header = req?.headers?.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

/**
 * Resuelve sesión + cliente con JWT. NO falla por sí mismo: devuelve
 * {user: null, client: null} si no hay token válido. Pensado para
 * usarse desde requireUser/requireAdmin o desde endpoints que aceptan
 * usuarios anónimos opcionalmente.
 *
 * @param {string | null} accessToken
 */
export async function authClientAndUser(accessToken) {
  if (!accessToken) return { client: null, user: null };
  try {
    const client = createAuthClient(accessToken);
    if (!client) return { client: null, user: null };
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) return { client: null, user: null };
    return { client, user: data.user };
  } catch {
    return { client: null, user: null };
  }
}

/**
 * Garantiza que la petición lleva un usuario autenticado válido.
 * Si no, devuelve {error: {status, message}}; el handler debe responder
 * `res.status(error.status).json({ error: error.message })` y retornar.
 *
 * @param {import("@vercel/node").VercelRequest} req
 * @returns {Promise<{user: any, authClient: any, error?: undefined} | {error: {status: number, message: string}, user?: undefined, authClient?: undefined}>}
 */
export async function requireUser(req) {
  const token = extractAccessToken(req);
  const { client, user } = await authClientAndUser(token);
  if (!user || !client) {
    return { error: { status: 401, message: "Unauthorized" } };
  }
  return { user, authClient: client };
}

/**
 * Como requireUser, pero además exige que el email del usuario esté
 * en ADMIN_EMAILS. Idéntico patrón de retorno.
 *
 * @param {import("@vercel/node").VercelRequest} req
 */
export async function requireAdmin(req) {
  const base = await requireUser(req);
  if (base.error) return base;
  const email = (base.user.email || "").toLowerCase();
  if (!ADMIN_EMAILS.includes(email)) {
    return { error: { status: 403, message: "Forbidden" } };
  }
  return base;
}
