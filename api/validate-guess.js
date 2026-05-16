// api/validate-guess.js
// Validación server-side del intento.
//
// REGLAS DE BLINDAJE (para que jamás se caiga en silencio en prod):
//   - SOLO POST. Cualquier otro método → 405 con JSON.
//   - Todo el handler va envuelto en try/catch. Cualquier excepción → 500
//     con `{ error: "..." }` y un log con etiqueta clara en server logs.
//   - req.body se parsea defensivamente (Vercel a veces no auto-parsea si el
//     Content-Type llega mal, o si el runtime cambia).
//   - Las llamadas a Supabase nunca tiran: comprobamos `error` en el tuple.
//   - Las RPCs (record_daily_result_v2) sí pueden tirar; van en su propio
//     try/catch para no romper el flujo principal.

import { createClient } from "@supabase/supabase-js";

const ANIO_CORRECT_MARGIN = 2;
const MAX_ATTEMPTS = 5;
const BASE_POINTS_BY_ATTEMPT = { 1: 10, 2: 6, 3: 4, 4: 3, 5: 2, 6: 1 };

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Cliente service_role: bypassea RLS y puede leer columnas privilegiadas
// (image_url, pick_daily_car). NUNCA debe filtrarse al cliente.
const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

function todayInMadrid() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function basePointsFor(attemptNumber, won) {
  if (!won) return 0;
  return BASE_POINTS_BY_ATTEMPT[attemptNumber] ?? 0;
}

function extractAccessToken(req) {
  const header = req.headers?.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

// Vercel suele auto-parsear JSON, pero si el Content-Type viene mal el body
// puede llegar como string o como Buffer. Lo normalizamos a objeto.
function parseBody(req) {
  const raw = req.body;
  if (raw == null) return {};
  if (typeof raw === "object" && !Buffer.isBuffer(raw)) return raw;
  if (Buffer.isBuffer(raw)) {
    try {
      return JSON.parse(raw.toString("utf8"));
    } catch {
      return {};
    }
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
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
    console.error("[validate-guess] authClientAndUser:", err);
    return { client: null, user: null };
  }
}

async function fetchCarById(id) {
  const { data, error } = await supabaseAdmin
    .from("cars")
    .select("id, make, model, year, pais, description")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data;
}

async function persistDailyResult({ accessToken, won, attemptNumber }) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !accessToken) return null;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.rpc("record_daily_result_v2", {
    p_won: won,
    p_attempt_number: attemptNumber,
  });
  if (error) throw error;
  return data;
}

export default async function handler(req, res) {
  // -------- 0. Método -----------------------------------------------------
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // -------- TRY/CATCH GLOBAL ---------------------------------------------
  try {
    // -------- 1. Sanity de configuración ---------------------------------
    if (!supabaseAdmin) {
      console.error("[validate-guess] missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL");
      return res.status(500).json({ error: "Server misconfigured" });
    }

    // -------- 2. Parseo y validación de input ----------------------------
    const body = parseBody(req);
    // Los ids de `cars` son UUIDs (string). Validamos forma básica para
    // evitar inyección en la query de Supabase: solo hex + guiones.
    const guessCarId =
      typeof body.guessCarId === "string" ? body.guessCarId.trim() : "";
    const guessAnio = body.anio;

    const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!guessCarId || !UUID_RE.test(guessCarId)) {
      return res.status(400).json({ error: "Invalid guessCarId" });
    }
    if (guessAnio === undefined || guessAnio === null) {
      return res.status(400).json({ error: "Invalid anio" });
    }

    const today = todayInMadrid();
    const accessToken = extractAccessToken(req);
    const { client: authClient, user } = await authClientAndUser(accessToken);

    // -------- 3. Coche del día (resuelto en servidor) --------------------
    const { data: todayCarId, error: pickErr } = await supabaseAdmin.rpc(
      "pick_daily_car",
      { p_date: today }
    );
    if (pickErr || !todayCarId) {
      console.error("[validate-guess] pick_daily_car:", pickErr);
      return res.status(500).json({ error: "Failed to resolve daily car" });
    }

    // -------- 4. Cargar coche-real y coche-guess -------------------------
    const [realRow, guessRow] = await Promise.all([
      fetchCarById(todayCarId),
      fetchCarById(guessCarId),
    ]);
    if (!realRow) {
      console.error("[validate-guess] daily car not in catalog:", todayCarId);
      return res.status(500).json({ error: "Daily car missing in catalog" });
    }
    if (!guessRow) {
      return res.status(400).json({ error: "Unknown guess car" });
    }

    const realCar = {
      marca: realRow.make,
      modelo: realRow.model,
      anio: realRow.year,
      pais: realRow.pais,
      description: realRow.description ?? null,
    };

    // -------- 5. attemptNumber server-side (logueados) -------------------
    let attemptNumber;
    let serverKnowsAttempts;
    let existingGuesses = [];
    if (user) {
      const { data: row, error: rowErr } = await authClient
        .from("user_guesses")
        .select("guesses, status")
        .eq("user_id", user.id)
        .eq("car_id", todayCarId)
        .eq("date", today)
        .maybeSingle();
      if (rowErr) {
        console.error("[validate-guess] read user_guesses:", rowErr);
        return res.status(500).json({ error: "Failed to read attempts" });
      }
      if (row?.status === "won" || row?.status === "lost") {
        return res.status(403).json({ error: "Game already finished" });
      }
      existingGuesses = Array.isArray(row?.guesses) ? row.guesses : [];
      if (existingGuesses.length >= MAX_ATTEMPTS) {
        return res.status(403).json({ error: "Max attempts reached" });
      }
      attemptNumber = existingGuesses.length + 1;
      serverKnowsAttempts = true;
    } else {
      const claimed = Number(body.attemptNumber);
      if (!Number.isInteger(claimed) || claimed < 1 || claimed > MAX_ATTEMPTS) {
        return res.status(400).json({ error: "Invalid attemptNumber" });
      }
      attemptNumber = claimed;
      serverKnowsAttempts = false;
    }

    // -------- 6. Comparación ---------------------------------------------
    const anioNum = parseInt(guessAnio, 10);
    const anioCorrect =
      Number.isFinite(anioNum) &&
      Math.abs(anioNum - realCar.anio) <= ANIO_CORRECT_MARGIN;

    const marcaOk = normalize(guessRow.make) === normalize(realCar.marca);
    const modeloOk = normalize(guessRow.model) === normalize(realCar.modelo);
    const paisOk =
      !marcaOk &&
      guessRow.pais &&
      realCar.pais &&
      guessRow.pais === realCar.pais;

    const result = {
      marca: {
        val: guessRow.make,
        status: marcaOk ? "correct" : paisOk ? "partial" : "wrong",
        pais: guessRow.pais,
      },
      modelo: {
        val: guessRow.model,
        status: modeloOk ? "correct" : "wrong",
      },
      anio: {
        val: String(guessAnio),
        status: anioCorrect ? "correct" : "wrong",
        direction: anioCorrect ? null : anioNum < realCar.anio ? "up" : "down",
      },
      win: marcaOk && modeloOk && anioCorrect,
    };

    const isGameOver = result.win || attemptNumber >= MAX_ATTEMPTS;
    const newStatus = result.win
      ? "won"
      : isGameOver
      ? "lost"
      : "playing";

    // -------- 7. Persistencia autoritativa (logueados) -------------------
    //   IMPORTANTE: usamos supabaseAdmin (service_role), NO authClient.
    //   Las policies de user_guesses se han endurecido para revocar
    //   INSERT/UPDATE/DELETE al rol `authenticated` — el cliente ya no puede
    //   escribir directamente desde el navegador. Esto bloquea dos cheats:
    //     - Pre-poblar `user_guesses` con guesses ganadoras para TODOS los
    //       car_id y llamar a record_daily_result_v2 → auto-win.
    //     - DELETE de la fila tras perder + recarga → replay ilimitado.
    if (user) {
      const newGuesses = [...existingGuesses, result];
      const { error: saveErr } = await supabaseAdmin.from("user_guesses").upsert(
        {
          user_id: user.id,
          car_id: todayCarId,
          date: today,
          guesses: newGuesses,
          status: newStatus,
          car_data: isGameOver ? { ...realCar, id: todayCarId } : null,
        },
        { onConflict: "user_id,car_id,date" }
      );
      if (saveErr) {
        console.error("[validate-guess] save user_guesses:", saveErr);
        // No abortamos: el cliente recibe el resultado igualmente.
      }
    }

    // -------- 8. Score + record_daily_result_v2 --------------------------
    const basePoints = basePointsFor(attemptNumber, result.win);
    let score = {
      basePoints,
      streakBonus: 0,
      totalPoints: basePoints,
      currentStreak: null,
      maxStreak: null,
      totalScore: null,
      persisted: false,
    };

    if (isGameOver && user && accessToken) {
      try {
        const persisted = await persistDailyResult({
          accessToken,
          won: result.win,
          attemptNumber,
        });
        if (persisted) {
          score = {
            basePoints: persisted.basePoints,
            streakBonus: persisted.streakBonus,
            totalPoints: persisted.totalPoints,
            currentStreak: persisted.currentStreak,
            maxStreak: persisted.maxStreak,
            totalScore: persisted.totalScore,
            alreadyRecorded: persisted.alreadyRecorded === true,
            persisted: true,
          };
        }
      } catch (err) {
        // No reventamos la respuesta principal: solo logueamos.
        console.error("[validate-guess] persistDailyResult:", err);
      }
    }

    // -------- 9. Política de revelado ------------------------------------
    let reveal = null;
    if (result.win || (isGameOver && serverKnowsAttempts)) {
      reveal = {
        marca: realCar.marca,
        modelo: realCar.modelo,
        anio: realCar.anio,
        pais: realCar.pais,
        description: realCar.description,
      };
    }

    return res.status(200).json({
      result,
      win: result.win,
      status: serverKnowsAttempts ? newStatus : isGameOver ? newStatus : "playing",
      attemptNumber,
      reveal,
      score,
    });
  } catch (err) {
    // Cualquier excepción no manejada arriba aterriza aquí: la convertimos
    // en una respuesta JSON 500 en vez de dejar que Vercel devuelva HTML.
    console.error("[validate-guess] UNCAUGHT:", err && err.stack ? err.stack : err);
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
