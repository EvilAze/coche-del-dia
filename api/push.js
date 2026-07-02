// api/push.js
// Alta y baja de suscripciones Web Push en UNA función EDGE (routing por
// `action` en el body). Edge en vez de Node por dos razones: (1) no gasta uno
// de los 12 slots de Serverless Function del plan Hobby (las Edge no cuentan);
// (2) no necesita `web-push` (eso solo lo usa el envío, api/_lib/cron/send-push).
//
// ADMIN-ONLY: escribe con el service role; la tabla push_subscriptions es
// deny-all para anon/authenticated. Identidad best-effort:
//   · endpoint = clave natural (upsert, un navegador = una fila).
//   · user_id  = si viene JWT de Supabase válido.
//   · anon_id  = del header x-anon-session verificado (versión Edge).

import { getSupabaseAdmin, getMissingAdminEnvs, createAuthClient } from "./_lib/supabase.js";
import { readAnonTokenFromRequest } from "./_lib/edge/anon-session.js";
import { checkRateLimit, getClientIpEdge } from "./_lib/ratelimit.js";

export const config = { runtime: "edge" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(request) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const missing = getMissingAdminEnvs();
  if (missing.length) {
    console.error("[push] envs admin ausentes:", missing.join(", "));
    return json({ error: "server_misconfigured" }, 500);
  }

  // Rate limit por IP: ni alta ni baja se llaman en ráfaga.
  const ip = getClientIpEdge(request);
  const rl = await checkRateLimit(`push:${ip}`, { max: 20, windowSec: 60, prefix: "rl" });
  if (!rl.ok) return json({ error: "rate_limited" }, 429);

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const admin = getSupabaseAdmin();

  // ---- BAJA --------------------------------------------------------------
  if (body?.action === "unsubscribe") {
    const endpoint = body.endpoint;
    if (!endpoint || typeof endpoint !== "string") {
      return json({ error: "invalid_endpoint" }, 400);
    }
    const { error } = await admin.from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (error) {
      console.error("[push] delete falló:", error.message);
      return json({ error: "db_error" }, 500);
    }
    return json({ ok: true });
  }

  // ---- ALTA --------------------------------------------------------------
  if (body?.action === "subscribe") {
    const sub = body.subscription;
    const locale = body.locale === "en" ? "en" : "es";
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return json({ error: "invalid_subscription" }, 400);
    }

    // Identidad best-effort. Ninguna es obligatoria (los anónimos son bienvenidos).
    let userId = null;
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (token) {
      try {
        const { data } = await createAuthClient(token).auth.getUser();
        userId = data?.user?.id ?? null;
      } catch {
        /* token inválido → tratamos como anónimo */
      }
    }
    let anonId = null;
    try {
      const payload = await readAnonTokenFromRequest(request); // {d,n,s} o null
      anonId = payload?.n ?? null;
    } catch {
      /* sin sesión anónima válida */
    }

    const { error } = await admin.from("push_subscriptions").upsert(
      {
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_id: userId,
        anon_id: anonId,
        locale,
        failure_count: 0,       // reset: re-suscribirse limpia fallos previos
        last_notified_at: null, // que reciba el próximo envío
      },
      { onConflict: "endpoint" }
    );
    if (error) {
      console.error("[push] upsert falló:", error.message);
      return json({ error: "db_error" }, 500);
    }
    return json({ ok: true });
  }

  return json({ error: "unknown_action" }, 400);
}
