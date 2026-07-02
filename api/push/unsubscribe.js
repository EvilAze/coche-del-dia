// api/push/unsubscribe.js
// Baja de una suscripción por endpoint. ADMIN-ONLY (delete con service role).
// No exige identidad: el endpoint es un secreto de facto (URL única de push),
// y borrarlo solo afecta a ese navegador. Node runtime.

import { applyCors, methodGuard, parseBody } from "../_lib/http.js";
import { getSupabaseAdmin, getMissingAdminEnvs } from "../_lib/supabase.js";
import { checkRateLimit } from "../_lib/ratelimit.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (methodGuard(req, res, ["POST"])) return;

  const missing = getMissingAdminEnvs();
  if (missing.length) {
    console.error("[push/unsubscribe] envs admin ausentes:", missing.join(", "));
    return res.status(500).json({ error: "server_misconfigured" });
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const rl = await checkRateLimit(`push-unsub:${ip}`, { max: 20, windowSec: 60, prefix: "rl" });
  if (!rl.ok) return res.status(429).json({ error: "rate_limited" });

  const body = parseBody(req) || {};
  const endpoint = body.endpoint;
  if (!endpoint || typeof endpoint !== "string") {
    return res.status(400).json({ error: "invalid_endpoint" });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) {
    console.error("[push/unsubscribe] delete falló:", error.message);
    return res.status(500).json({ error: "db_error" });
  }
  return res.status(200).json({ ok: true });
}
