// api/health.js
// Endpoint público de health para monitorización externa (Better Stack).
// Comprueba que Supabase responde y devuelve 200/503 en consecuencia.
//
// HARDENING: público (el monitor debe alcanzarlo) pero inofensivo — lectura
// trivial vía cliente anónimo, sin secretos, sin escritura, sin pistas del
// coche del día. El body no expone detalle del error (solo db:"down"); el
// detalle real va a console.error (logs de Vercel).
//
// Runtime Edge `fra1`: cold-start bajo (el chequeo mide la salud real de
// Supabase, no el ruido de arranque) y no consume un slot de función
// serverless del plan Hobby.

import { getSupabasePublic } from "./_lib/supabase.js";
import { checkDbHealth } from "./_lib/health.js";

export const config = {
  runtime: "edge",
  regions: ["fra1"],
};

export default async function handler() {
  const client = getSupabasePublic();
  const ok = await checkDbHealth(client, { timeoutMs: 4000 });

  const body = ok ? { status: "ok", db: "up" } : { status: "error", db: "down" };
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
