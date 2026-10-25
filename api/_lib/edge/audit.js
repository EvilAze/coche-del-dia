// api/_lib/edge/audit.js
// Logger edge-safe (Web Crypto, sin node:crypto) para registrar la PRIMERA
// visita del día de un usuario/IP en /api/get-daily-car. Después se puede
// calcular time-to-win como (guess_audit.ts del win) − (session_start.ts).
//
// Se inserta en la misma tabla `guess_audit` con mode='session_start',
// attempt_number=0, win=false. No requiere cambios de esquema.
//
// HMAC compatible con el helper Node (api/_lib/audit.js): mismo SECRET,
// mismo algoritmo (HMAC-SHA256), mismo formato (hex truncado a 32 chars).
// Así una misma IP produce el MISMO ip_hash tanto si entra por edge
// (session_start) como por Node (guess en validate-guess). Sin esto, no
// se podrían cruzar las dos rutas.

import { getSupabaseAdmin } from "../supabase.js";

const SECRET = (typeof process !== "undefined" ? process.env.REPESCA_TOKEN_SECRET : "") || "";

// Dedup en memoria de la instancia warm — mismo patrón que ratelimit.js.
// Best-effort: instancias warm distintas pueden duplicar (toleramos: el
// query del admin coge MIN(ts) por usuario/día). Evita que cada F5 del
// jugador legítimo dispare otra fila.
const SEEN = new Set();
const MAX_SEEN = 5000;

async function hmacHexEdge(message) {
  if (!SECRET || !message) return null;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(String(message)));
    // Mismo formato que Node's createHmac().digest("hex").slice(0,32).
    return [...new Uint8Array(sig)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32);
  } catch {
    return null;
  }
}

function getIp(request) {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

function clip(value, max) {
  if (value == null) return null;
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Registra un session_start best-effort. Llamar SIN await para no añadir
 * latencia al primer paint, pero pasando el `context` del handler.
 *
 * POR QUÉ `context.waitUntil` Y NO «que vuele en background». Aquí se asumía
 * que Vercel deja terminar las fetches en vuelo tras devolver la Response, y
 * no es así en Edge: lo que extiende la vida de la función es `waitUntil`. Sin
 * él, el insert competía contra el final de la respuesta y perdía justo cuando
 * la visita era la de una partida EMPEZANDO (el handler devuelve casi al
 * instante), mientras que ganaba cuando la partida ya estaba cerrada (ahí el
 * handler espera otra lectura a Supabase y le da margen). Resultado medido en
 * producción: casi todos los session_start de un jugador eran POSTERIORES a su
 * victoria, así que el time-to-win del panel de auditoría salía negativo para
 * todo el mundo.
 *
 * Sin `context` (vercel dev, tests) se comporta como antes: la promesa queda
 * suelta, que es lo mejor que se puede hacer sin runtime que la sostenga.
 */
export function logSessionStart({ request, userId, isAnon, gameDate, carId, context }) {
  const trabajo = registrarSessionStart({ request, userId, isAnon, gameDate, carId });
  if (typeof context?.waitUntil === "function") context.waitUntil(trabajo);
  return trabajo;
}

async function registrarSessionStart({ request, userId, isAnon, gameDate, carId }) {
  try {
    if (!carId || !gameDate) return;
    const ip = getIp(request);
    const ipHash = await hmacHexEdge(ip);
    // Identidad para dedupe: user_id si está logueado, ip_hash si es anon.
    const idKey = userId || ipHash || "unknown";
    const dedupKey = `${gameDate}|${idKey}`;
    if (SEEN.has(dedupKey)) return;
    if (SEEN.size > MAX_SEEN) SEEN.clear();
    SEEN.add(dedupKey);

    const admin = getSupabaseAdmin();
    if (!admin) return;
    const { error } = await admin.from("guess_audit").insert({
      mode: "session_start",
      game_date: gameDate,
      car_id: carId,
      user_id: userId || null,
      is_anon: Boolean(isAnon),
      anon_n: null,
      attempt_number: 0,
      ip_hash: ipHash,
      ua: clip(request.headers.get("user-agent"), 300),
      accept_lang: clip(request.headers.get("accept-language"), 120),
      win: false,
    });
    if (error) console.error("[edge/audit] session_start insert:", error.message || error);
  } catch (err) {
    console.error("[edge/audit] logSessionStart:", err?.message || err);
  }
}
