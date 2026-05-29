// api/_lib/audit.js
// Logging best-effort de intentos en la tabla OCULTA public.guess_audit
// (ver scripts/supabase-guess-audit.sql). Sirve para auditar el patrón de
// "oráculo": misma IP sondeando el coche de hoy desde sesiones distintas y
// luego ganándolo a la primera con la cuenta real.
//
// PRINCIPIOS:
//   - NUNCA tira: cualquier fallo se traga con un console.error. El log de
//     auditoría jamás debe degradar la jugabilidad.
//   - La IP se guarda HASHEADA (HMAC con REPESCA_TOKEN_SECRET): suficiente
//     para correlacionar sesiones sin almacenar la IP en claro.
//   - Inserta con service_role (getSupabaseAdmin): la tabla está cerrada a
//     anon/authenticated por RLS deny-all.

import crypto from "crypto";
import { getSupabaseAdmin } from "./supabase.js";

const SECRET = process.env.REPESCA_TOKEN_SECRET || "";

// HMAC de la IP. Si no hay secreto o IP, devolvemos null (no rompemos).
export function hashIp(ip) {
  if (!SECRET || !ip) return null;
  try {
    return crypto.createHmac("sha256", SECRET).update(String(ip)).digest("hex").slice(0, 32);
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
    const { error } = await admin.from("guess_audit").insert(row);
    if (error) console.error("[audit] insert:", error.message || error);
  } catch (err) {
    console.error("[audit] logGuessAttempt:", err?.message || err);
  }
}
