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
import { pseudoIdFor, resolveRealCarId } from "../_lib/repesca-token.js";

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

// Lee el estado actual de una partida de repesca (user_guesses) y lo
// formatea para que el cliente lo pinte directamente sin necesitar el
// cars.id real. Usa authClient para que RLS confirme que la fila es del
// usuario (defensa en profundidad — ya validamos auth.uid arriba).
async function readRepescaState(authClient, userId, carId, today) {
  const { data: row, error } = await authClient
    .from("user_guesses")
    .select("guesses, status, car_data")
    .eq("user_id", userId)
    .eq("car_id", carId)
    .eq("date", today)
    .maybeSingle();
  if (error) {
    console.error("[repesca/start] readRepescaState:", error);
    return { guesses: [], status: "playing", reveal: null };
  }
  const status = row?.status || "playing";
  let reveal = null;
  // Solo exponemos reveal cuando la partida está cerrada: en repesca
  // se revela tanto al ganar como al perder (igual que daily logueado).
  if ((status === "won" || status === "lost") && row?.car_data) {
    reveal = {
      marca: row.car_data.marca,
      modelo: row.car_data.modelo,
      anio: row.car_data.anio,
      pais: row.car_data.pais,
      description: row.car_data.description ?? null,
      description_en: row.car_data.description_en ?? null,
    };
  }
  return {
    guesses: Array.isArray(row?.guesses) ? row.guesses : [],
    status,
    reveal,
  };
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
    const pseudoCarId =
      typeof body.carId === "string" ? body.carId.trim() : "";
    if (!pseudoCarId) {
      return res.status(400).json({ error: "Missing carId" });
    }

    // Resolver pseudo → cars.id real. El cliente nunca conoce el id real
    // de un coche bloqueado; nos envía el pseudo y aquí lo traducimos.
    const { data: allCarRows, error: allCarsErr } = await supabaseAdmin
      .from("cars")
      .select("id");
    if (allCarsErr) {
      console.error("[repesca/start] read cars:", allCarsErr);
      return res.status(500).json({ error: "Failed to load catalog" });
    }
    const carId = resolveRealCarId(
      pseudoCarId,
      user.id,
      (allCarRows || []).map((c) => c.id)
    );
    if (!carId) {
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

    // 3) Estado de la repesca actual del usuario. Lectura con service_role:
    //    `stats` solo tiene policies de SELECT públicas en este proyecto, y
    //    las escrituras desde el cliente están deliberadamente bloqueadas
    //    (no hay policy INSERT/UPDATE para authenticated). Toda mutación
    //    sobre stats pasa por endpoints server-side, igual que hace el RPC
    //    record_daily_result_v2 con SECURITY DEFINER.
    const { data: statsRow, error: statsErr } = await supabaseAdmin
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
        // Incluimos también el estado actual de la partida para que el
        // cliente no necesite leer user_guesses por su cuenta (lo cual
        // exigiría conocer el carId real, justo lo que queremos ocultar).
        const resumeState = await readRepescaState(authClient, user.id, carId, today);
        return res.status(200).json({
          ok: true,
          // Devolvemos el pseudo, no el real. El cliente nos lo envió;
          // se lo eco-respondemos para que pueda usarlo en image/validate
          // sin guardarlo en algún state extra.
          carId: pseudoCarId,
          resume: true,
          state: resumeState,
        });
      }
      // Repesca ya gastada en otro coche. Convertimos el carId activo
      // también a pseudo antes de exponerlo.
      return res.status(409).json({
        error: "Repesca already used today",
        activeCarId: pseudoIdFor(statsRow.last_repesca_car_id, user.id),
      });
    }

    // 4) Consumir la repesca: marcar fecha y car_id en stats.
    //    Usamos upsert con service_role para saltar RLS — el cliente no
    //    tiene permisos de INSERT/UPDATE sobre stats por diseño (ver nota
    //    en el paso 3). El usuario no puede manipular estos campos desde
    //    DevTools porque sus credenciales no pueden tocar la tabla.
    const { error: upsertErr } = await supabaseAdmin
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
      // Logueamos TODO lo que devuelve Supabase: en logs de Vercel queda
      // el message + code + details + hint. Devolvemos en `detail` el
      // mensaje + código para que la modal del frontend lo muestre y
      // podamos diagnosticar en producción sin tener que abrir logs.
      console.error("[repesca/start] upsert stats:", {
        message: upsertErr.message,
        code: upsertErr.code,
        details: upsertErr.details,
        hint: upsertErr.hint,
      });
      return res.status(500).json({
        error: "Failed to consume repesca",
        detail: `${upsertErr.message}${upsertErr.code ? ` (code ${upsertErr.code})` : ""}`,
      });
    }

    // Primer arranque tras consumir: state nuevo, sin intentos previos.
    const freshState = await readRepescaState(authClient, user.id, carId, today);
    return res.status(200).json({
      ok: true,
      carId: pseudoCarId,   // eco del pseudo, nunca exponemos el real
      resume: false,
      state: freshState,
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
