// api/cron/send-push.js
// Envío diario del recordatorio Web Push. Lo dispara GitHub Actions a las 15:00
// UTC (~16:00/17:00 Madrid) con Authorization: Bearer CRON_SECRET (mismo patrón
// que warm-daily.js). Node runtime (web-push usa crypto de Node).
//
// Idempotencia por día: solo envía a subs con last_notified_at != hoy, y las
// marca al enviar → un re-disparo manual no duplica. Purga las expiradas (404/
// 410) y cuenta fallos (borra tras 3). Sentry captura errores SIN PII.

import webpush from "web-push";
import { getSupabaseAdmin, getMissingAdminEnvs } from "../supabase.js";
import {
  getPushCopy,
  buildPushPayload,
  classifySendError,
  madridDateStr,
} from "../push.js";

const BATCH = 100; // enviar en lotes para no saturar

export async function sendPush(req, res) {
  // --- AUTH: mismo esquema que los crons existentes ---
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/send-push] CRON_SECRET no configurado");
    return res.status(500).json({ error: "server_misconfigured" });
  }
  if ((req.headers.authorization || "") !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  // --- ENVS ---
  const missing = getMissingAdminEnvs();
  if (missing.length) {
    console.error("[cron/send-push] envs admin ausentes:", missing.join(", "));
    return res.status(500).json({ error: "server_misconfigured" });
  }
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    console.error("[cron/send-push] envs VAPID ausentes");
    return res.status(500).json({ error: "server_misconfigured" });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const admin = getSupabaseAdmin();
  const today = madridDateStr();

  // Subs pendientes de aviso hoy (nunca avisadas o avisadas otro día).
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, locale, failure_count")
    .or(`last_notified_at.is.null,last_notified_at.neq.${today}`);
  if (error) {
    console.error("[cron/send-push] query falló:", error.message);
    return res.status(500).json({ error: "db_error" });
  }

  const notifiedIds = [];
  const expiredIds = [];
  const failBump = []; // { id, failure_count }

  for (let i = 0; i < (subs?.length || 0); i += BATCH) {
    const slice = subs.slice(i, i + BATCH);
    await Promise.allSettled(
      slice.map(async (s) => {
        const copy = getPushCopy(s.locale);
        // URL con UTM: al abrir la notificación, Umami atribuye el retorno a
        // "push" (mide si el aviso realmente trae gente de vuelta).
        const payload = buildPushPayload({
          title: copy.title,
          body: copy.body,
          url: "/?utm_source=push&utm_medium=web_push",
        });
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          );
          notifiedIds.push(s.id);
        } catch (err) {
          if (classifySendError(err) === "expired") expiredIds.push(s.id);
          else failBump.push({ id: s.id, failure_count: (s.failure_count || 0) + 1 });
        }
      })
    );
  }

  // Marcar enviadas hoy (idempotencia).
  if (notifiedIds.length) {
    await admin
      .from("push_subscriptions")
      .update({ last_notified_at: today, failure_count: 0 })
      .in("id", notifiedIds);
  }
  // Borrar expiradas.
  if (expiredIds.length) {
    await admin.from("push_subscriptions").delete().in("id", expiredIds);
  }
  // Subir contador de fallos; borrar las que llegan a 3.
  for (const f of failBump) {
    if (f.failure_count >= 3) {
      await admin.from("push_subscriptions").delete().eq("id", f.id);
    } else {
      await admin.from("push_subscriptions").update({ failure_count: f.failure_count }).eq("id", f.id);
    }
  }

  return res.status(200).json({
    ok: true,
    sent: notifiedIds.length,
    expired: expiredIds.length,
    failed: failBump.length,
  });
}
