// api/cron/[...job].js
// Catch-all que agrupa TODOS los jobs de cron en UNA sola Serverless Function.
// Motivo: el plan Hobby de Vercel limita a 12 funciones serverless por deploy y
// estábamos justo en el tope; en vez de gastar un slot por cron, los tres jobs
// (warm-daily, monthly-podium, send-push) viven en `api/_lib/cron/` (prefijo _
// → Vercel NO los cuenta como funciones) y este dispatcher los enruta. Mismo
// patrón que api/admin/[...slug].js.
//
// Rutas que resuelven aquí (sin cambiar vercel.json ni el workflow):
//   · /api/cron/warm-daily     → job=["warm-daily"]     (Vercel Cron, diario)
//   · /api/cron/monthly-podium → job=["monthly-podium"] (Vercel Cron, mensual)
//   · /api/cron/send-push      → job=["send-push"]      (GitHub Actions, 15:00 UTC)
//
// La AUTH (Bearer CRON_SECRET) la sigue haciendo cada handler internamente, así
// que aquí solo despachamos.

import { warmDaily } from "../_lib/cron/warm-daily.js";
import { monthlyPodium } from "../_lib/cron/monthly-podium.js";
import { sendPush } from "../_lib/cron/send-push.js";

const JOBS = {
  "warm-daily": warmDaily,
  "monthly-podium": monthlyPodium,
  "send-push": sendPush,
};

export default async function handler(req, res) {
  // Vercel puede pasar req.query.job como array (["warm-daily"]), string suelta,
  // o NO poblarlo (verificado en prod: llegaba null). Igual que el catch-all de
  // admin (api/admin/[...slug].js), normalizamos y, si viene vacío, parseamos el
  // segmento a mano desde req.url — robusto a cómo Vercel resuelva el catch-all.
  const raw = req.query.job;
  let name;
  if (Array.isArray(raw)) name = raw.join("/");
  else if (typeof raw === "string" && raw.length > 0) name = raw;
  else if (req.url) {
    const path = req.url.split("?")[0];
    const m = path.match(/^\/api\/cron\/(.+?)\/?$/);
    if (m) name = m[1];
  }

  const job = JOBS[name];
  if (!job) {
    return res.status(404).json({ error: "unknown_job", job: name ?? null });
  }
  return job(req, res);
}
