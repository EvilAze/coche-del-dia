// api/_lib/audit.js
// Logging best-effort de intentos en la tabla OCULTA public.guess_audit
// (ver scripts/supabase-guess-audit.sql). Sirve para auditar el patrón de
// "oráculo": misma IP sondeando el coche de hoy desde sesiones distintas y
// luego ganándolo a la primera con la cuenta real.
//
// PRINCIPIOS:
//   - NUNCA tira: cualquier fallo se traga con un console.error. El log de
//     auditoría jamás debe degradar la jugabilidad.
//   - Y NUNCA ESPERA INDEFINIDAMENTE, que es la otra mitad de lo mismo: los
//     dos handlers que llaman aquí lo hacen con `await` justo antes de
//     responder, así que sin plazo un PostgREST atrancado convierte un intento
//     ya validado en un 504 con HTML (regla 21). El try/catch cubría a la base
//     que contesta mal, no a la que no contesta. Plazo corto a propósito
//     (PLAZOS.AUDITORIA): al vencer no se pierde nada que el jugador vea.
//   - La IP se guarda HASHEADA (HMAC con REPESCA_TOKEN_SECRET): suficiente
//     para correlacionar sesiones sin almacenar la IP en claro.
//   - Inserta con service_role (getSupabaseAdmin): la tabla está cerrada a
//     anon/authenticated por RLS deny-all.

import crypto from "crypto";
import { getSupabaseAdmin } from "./supabase.js";
import { conTimeoutOFallback, PLAZOS } from "./timeout.js";

// Un insert de auditoría, acotado. Sin reintento a propósito: si la tabla
// oculta no admite la fila a la primera, volver a intentarlo gasta presupuesto
// de la función por una fila que nadie está esperando.
function insertarAcotado(admin, row, etiqueta) {
  return conTimeoutOFallback(
    admin.from("guess_audit").insert(row),
    PLAZOS.AUDITORIA,
    { error: { message: `${etiqueta} sin respuesta a tiempo` } },
    { etiqueta }
  );
}

// Perezoso (función, no `const` al importar): igual que la regla 2 prohíbe
// `const supabase = createClient(...)` a nivel de módulo, leer el env aquí
// arriba congelaría un secreto vacío si REPESCA_TOKEN_SECRET llega después
// del import — y a partir de ahí todo hash de IP se quedaría en `null` sin
// que nada lo explique (el log seguiría insertando filas, solo que sin poder
// correlacionar sesiones).
const SECRET = () => process.env.REPESCA_TOKEN_SECRET || "";

// HMAC de la IP. Si no hay secreto o IP, devolvemos null (no rompemos).
function hashIp(ip) {
  const secret = SECRET();
  if (!secret || !ip) return null;
  try {
    return crypto.createHmac("sha256", secret).update(String(ip)).digest("hex").slice(0, 32);
  } catch {
    return null;
  }
}

function clip(value, max) {
  if (value == null) return null;
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Registra un intento. Todos los campos opcionales se normalizan.
 * Fire-and-forget seguro: se await-ea dentro de un try/catch en el caller,
 * pero aquí también blindamos por si acaso.
 */
export async function logGuessAttempt({
  req,
  mode,            // 'daily' | 'repesca'
  gameDate,
  carId,
  userId = null,
  isAnon,
  anonN = null,
  attemptNumber,
  ip,
  guess,           // { make, model, year }
  result,          // objeto result de validate-guess
}) {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return;
    const headers = req?.headers || {};
    const row = {
      mode,
      game_date: gameDate,
      car_id: carId,
      user_id: userId,
      is_anon: Boolean(isAnon),
      anon_n: Number.isInteger(anonN) ? anonN : null,
      attempt_number: attemptNumber,
      ip_hash: hashIp(ip),
      ua: clip(headers["user-agent"], 300),
      accept_lang: clip(headers["accept-language"], 120),
      guess_make: clip(guess?.make, 120),
      guess_model: clip(guess?.model, 120),
      guess_year: Number.isFinite(Number(guess?.year)) ? Number(guess.year) : null,
      marca_status: result?.marca?.status ?? null,
      modelo_status: result?.modelo?.status ?? null,
      anio_status: result?.anio?.status ?? null,
      win: Boolean(result?.win),
    };
    const { error } = await insertarAcotado(admin, row, "guess_audit insert");
    if (error) console.error("[audit] insert:", error.message || error);
  } catch (err) {
    console.error("[audit] logGuessAttempt:", err?.message || err);
  }
}

/**
 * Registra un evento de seguridad "canary": algo que un cliente legítimo
 * NUNCA hace (p.ej. presentar un revealToken forjado a /api/daily-image).
 * Se guarda en la misma tabla con mode='canary', attempt_number=0 y
 * win=false para no contaminar las consultas de intentos reales. El motivo
 * va en `note`. Best-effort: nunca tira.
 */
export async function logCanary({ req, reason, carId, gameDate, userId = null, isAnon, ip }) {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return;
    const headers = req?.headers || {};
    const { error } = await insertarAcotado(admin, {
      mode: "canary",
      game_date: gameDate,
      car_id: carId,
      user_id: userId,
      is_anon: Boolean(isAnon),
      anon_n: null,
      attempt_number: 0,
      ip_hash: hashIp(ip),
      ua: clip(headers["user-agent"], 300),
      accept_lang: clip(headers["accept-language"], 120),
      win: false,
      note: clip(reason, 200),
    }, "canary insert");
    if (error) console.error("[audit] canary insert:", error.message || error);
  } catch (err) {
    console.error("[audit] logCanary:", err?.message || err);
  }
}
