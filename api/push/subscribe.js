// api/push/subscribe.js
// Alta/actualización de una suscripción Web Push. ADMIN-ONLY: escribimos con el
// service role (la tabla es deny-all para anon/authenticated). Identidad:
//   · endpoint = clave natural (upsert, un navegador = una fila).
//   · user_id  = si viene JWT de Supabase válido (best-effort).
//   · anon_id  = del header x-anon-session verificado (best-effort).
// Node runtime: web-push/crypto y supabase admin no van en Edge.

import { applyCors, methodGuard, parseBody } from "../_lib/http.js";
import { getSupabaseAdmin, getMissingAdminEnvs, createAuthClient } from "../_lib/supabase.js";
import { readAnonToken } from "../_lib/anon-session.js";
import { checkRateLimit } from "../_lib/ratelimit.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;              // responde preflight OPTIONS
  if (methodGuard(req, res, ["POST"])) return;  // 405 si no es POST

  const missing = getMissingAdminEnvs();
  if (missing.length) {
    console.error("[push/subscribe] envs admin ausentes:", missing.join(", "));
    return res.status(500).json({ error: "server_misconfigured" });
  }

  // Rate limit por IP: alta no debería llamarse en ráfaga. En runtime Node la
  // IP viene en x-forwarded-for (getClientIpEdge es solo para Edge/Request).
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const rl = await checkRateLimit(`push-sub:${ip}`, { max: 20, windowSec: 60, prefix: "rl" });
  if (!rl.ok) return res.status(429).json({ error: "rate_limited" });

  const body = parseBody(req) || {};
  const sub = body.subscription;
  const locale = body.locale === "en" ? "en" : "es";
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return res.status(400).json({ error: "invalid_subscription" });
  }

  // Identidad best-effort. Ninguna es obligatoria (los anónimos son bienvenidos).
  let userId = null;
  const authHeader = req.headers.authorization || "";
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
    const payload = readAnonToken(req); // {d, n, s} o null
    anonId = payload?.n ?? null;
  } catch {
    /* sin sesión anónima válida */
  }

  const admin = getSupabaseAdmin();
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
    console.error("[push/subscribe] upsert falló:", error.message);
    return res.status(500).json({ error: "db_error" });
  }
  return res.status(200).json({ ok: true });
}
