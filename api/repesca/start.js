// api/repesca/start.js
// Inicia (o reanuda) una repesca: valida que el coche es elegible y consume
// la repesca diaria del usuario.
//
// REGLAS:
//   - Solo usuarios autenticados.
//   - Solo se puede repescar un coche que YA haya sido "Coche del Día"
//     (existe en daily_cars con fecha < hoy). Nada de coches futuros.
//   - El usuario no puede repescar un coche que ya ganó.
//   - Una repesca al día. Si ya consumió hoy:
//       - Si era para este mismo carId → idempotente: devolvemos OK con
//         resume:true (sirve para refresh / volver a abrir).
//       - Si era para otro → 409 "Repesca ya consumida hoy".

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function todayInMadrid() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function extractAccessToken(req) {
  const header = req.headers?.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

function parseBody(req) {
  const raw = req.body;
  if (raw == null) return {};
  if (typeof raw === "object" && !Buffer.isBuffer(raw)) return raw;
  if (Buffer.isBuffer(raw)) {
    try { return JSON.parse(raw.toString("utf8")); } catch { return {}; }
  }
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}

async function authClientAndUser(accessToken) {
  if (!accessToken) return { client: null, user: null };
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) return { client: null, user: null };
    return { client, user: data.user };
  } catch (err) {
    console.error("[repesca/start] authClientAndUser:", err);
    return { client: null, user: null };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const accessToken = extractAccessToken(req);
    const { client: authClient, user } = await authClientAndUser(accessToken);
    if (!user || !authClient) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = parseBody(req);
    const carId = typeof body.carId === "string" ? body.carId.trim() : "";
    if (!UUID_RE.test(carId)) {
      return res.status(400).json({ error: "Invalid carId" });
    }

    const today = todayInMadrid();

    // 1) ¿El coche ha sido coche del día? Buscamos cualquier fila en
    //    daily_cars con fecha < hoy. Solo entonces es repescable.
    const { data: pastDaily, error: pastErr } = await supabaseAdmin
      .from("daily_cars")
      .select("car_id, date")
      .eq("car_id", carId)
      .lt("date", today)
      .limit(1)
      .maybeSingle();
    if (pastErr) {
      console.error("[repesca/start] read daily_cars:", pastErr);
      return res.status(500).json({ error: "Failed to check history" });
    }
    if (!pastDaily) {
      return res.status(403).json({
        error: "Car not eligible for repesca",
        detail: "Solo se pueden repescar coches que ya hayan sido coche del día.",
      });
    }

    // 2) ¿El usuario ya ganó este coche? Si sí, no tiene sentido repescar.
    const { data: alreadyWon, error: wonErr } = await authClient
      .from("user_guesses")
      .select("car_id")
      .eq("user_id", user.id)
      .eq("car_id", carId)
      .eq("status", "won")
      .limit(1)
      .maybeSingle();
    if (wonErr) {
      console.error("[repesca/start] read user_guesses:", wonErr);
      return res.status(500).json({ error: "Failed to check wins" });
    }
    if (alreadyWon) {
      return res.status(409).json({ error: "Already unlocked" });
    }

    // 3) Estado de la repesca actual del usuario.
    const { data: statsRow, error: statsErr } = await authClient
      .from("stats")
      .select("last_repesca_at, last_repesca_car_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (statsErr) {
      console.error("[repesca/start] read stats:", statsErr);
      return res.status(500).json({ error: "Failed to read stats" });
    }

    const alreadyConsumedToday = statsRow?.last_repesca_at === today;
    if (alreadyConsumedToday) {
      if (statsRow.last_repesca_car_id === carId) {
        // Reanudación legítima: idempotente, no consumimos de nuevo.
        return res.status(200).json({
          ok: true,
          carId,
          resume: true,
        });
      }
      // Repesca ya gastada en otro coche.
      return res.status(409).json({
        error: "Repesca already used today",
        activeCarId: statsRow.last_repesca_car_id,
      });
    }

    // 4) Consumir la repesca: marcar fecha y car_id en stats.
    //    Usamos upsert porque algunos usuarios pueden no tener fila en
    //    stats todavía (la fila se crea al primer record_daily_result_v2).
    const { error: upsertErr } = await authClient
      .from("stats")
      .upsert(
        {
          user_id: user.id,
          last_repesca_at: today,
          last_repesca_car_id: carId,
        },
        { onConflict: "user_id" }
      );
    if (upsertErr) {
      console.error("[repesca/start] upsert stats:", upsertErr);
      return res.status(500).json({ error: "Failed to consume repesca" });
    }

    return res.status(200).json({
      ok: true,
      carId,
      resume: false,
    });
  } catch (err) {
    console.error("[repesca/start] UNCAUGHT:", err && err.stack ? err.stack : err);
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
