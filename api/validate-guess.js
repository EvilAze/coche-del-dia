// api/validate-guess.js
// Validación server-side de un intento. El cliente envía SOLO el id del coche
// que ha elegido en el autocompletado (más el año tecleado). El servidor:
//   - Resuelve el coche del día por su cuenta (pick_daily_car con service_role).
//   - Carga marca/modelo/pais/año reales del coche-guess y del coche-real.
//   - Compara y devuelve únicamente los colores + win.
//   - Persiste user_guesses de forma autoritativa para usuarios logueados.
//
// REGLA: jamás se devuelven los datos reales del coche del día si el usuario
// no ha ganado. La imagen sigue accesible vía /api/daily-image (proxy), así
// que la pantalla de fin de partida puede seguir mostrando la foto sin saber
// marca/modelo/año.

import { createClient } from "@supabase/supabase-js";

const ANIO_CORRECT_MARGIN = 2;
const MAX_ATTEMPTS = 5;
const BASE_POINTS_BY_ATTEMPT = { 1: 10, 2: 6, 3: 4, 4: 3, 5: 2, 6: 1 };

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY
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

async function authClientAndUser(accessToken) {
  if (!accessToken) return { client: null, user: null };
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return { client: null, user: null };
  return { client, user: data.user };
}

async function fetchCarById(id) {
  const { data, error } = await supabaseAdmin
    .from("cars")
    .select("id, make, model, year, pais")
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
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Only POST allowed" });
  }

  if (!supabaseAdmin) {
    console.error("[validate-guess] missing SUPABASE_SERVICE_ROLE_KEY");
    return res.status(500).json({ message: "Server misconfigured" });
  }

  // -------- 1. Input validation -------------------------------------------
  const body = req.body || {};
  const guessCarId = Number(body.guessCarId);
  const guessAnio = body.anio;

  if (!Number.isInteger(guessCarId) || guessCarId <= 0) {
    return res.status(400).json({ message: "Invalid guessCarId" });
  }
  if (guessAnio === undefined || guessAnio === null) {
    return res.status(400).json({ message: "Invalid anio" });
  }

  const today = todayInMadrid();
  const accessToken = extractAccessToken(req);
  const { client: authClient, user } = await authClientAndUser(accessToken);

  // -------- 2. El servidor decide cuál es el coche del día ----------------
  const { data: todayCarId, error: pickErr } = await supabaseAdmin.rpc(
    "pick_daily_car",
    { p_date: today }
  );
  if (pickErr || !todayCarId) {
    console.error("[validate-guess] pick_daily_car:", pickErr);
    return res.status(500).json({ message: "Failed to resolve daily car" });
  }

  // -------- 3. Cargar coche-real y coche-guess ----------------------------
  const [realRow, guessRow] = await Promise.all([
    fetchCarById(todayCarId),
    fetchCarById(guessCarId),
  ]);
  if (!realRow) {
    return res.status(500).json({ message: "Daily car missing in catalog" });
  }
  if (!guessRow) {
    return res.status(400).json({ message: "Unknown guess car" });
  }

  const realCar = {
    marca: realRow.make,
    modelo: realRow.model,
    anio: realRow.year,
    pais: realRow.pais,
  };

  // -------- 4. Server decide el número de intento -------------------------
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
      return res.status(500).json({ message: "Failed to read attempts" });
    }
    if (row?.status === "won" || row?.status === "lost") {
      return res.status(403).json({ message: "Game already finished" });
    }
    existingGuesses = Array.isArray(row?.guesses) ? row.guesses : [];
    if (existingGuesses.length >= MAX_ATTEMPTS) {
      return res.status(403).json({ message: "Max attempts reached" });
    }
    attemptNumber = existingGuesses.length + 1;
    serverKnowsAttempts = true;
  } else {
    const claimed = Number(body.attemptNumber);
    if (!Number.isInteger(claimed) || claimed < 1 || claimed > MAX_ATTEMPTS) {
      return res.status(400).json({ message: "Invalid attemptNumber" });
    }
    attemptNumber = claimed;
    serverKnowsAttempts = false;
  }

  // -------- 5. Comparación -------------------------------------------------
  const anioNum = parseInt(guessAnio, 10);
  const anioCorrect =
    Number.isFinite(anioNum) &&
    Math.abs(anioNum - realCar.anio) <= ANIO_CORRECT_MARGIN;

  const marcaOk = normalize(guessRow.make) === normalize(realCar.marca);
  const modeloOk = normalize(guessRow.model) === normalize(realCar.modelo);
  const paisOk =
    !marcaOk && guessRow.pais && realCar.pais && guessRow.pais === realCar.pais;

  // El campo `val` que se pinta en GuessRow viene de la fila DEL CATÁLOGO,
  // no del texto que mandó el cliente. Así no nos comemos cualquier basura
  // que un atacante intente colar en marca/modelo.
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

  // -------- 6. Persistencia autoritativa (solo logueados) -----------------
  if (user && authClient) {
    const newGuesses = [...existingGuesses, result];
    const { error: saveErr } = await authClient.from("user_guesses").upsert(
      {
        user_id: user.id,
        car_id: todayCarId,
        date: today,
        guesses: newGuesses,
        status: newStatus,
        // Guardamos car_data para que sirva de histórico server-side, pero
        // jamás lo devolvemos al cliente si no ganó.
        car_data: isGameOver
          ? { ...realCar, id: todayCarId }
          : null,
      },
      { onConflict: "user_id,car_id,date" }
    );
    if (saveErr) {
      console.error("[validate-guess] save user_guesses:", saveErr);
    }
  }

  // -------- 7. Score + record_daily_result_v2 -----------------------------
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
      console.error("[validate-guess] persistDailyResult:", err);
    }
  }

  // -------- 8. Política de revelado ---------------------------------------
  // Revelamos marca/modelo/año si:
  //   - El usuario ha ganado (siempre, anónimo o logueado).
  //   - El usuario ha perdido Y está logueado: el servidor ha verificado los
  //     intentos contra user_guesses, así que no se puede saltar la partida
  //     mandando attemptNumber:5 sin jugar.
  // Anónimos que pierden NO reciben reveal: tienen que iniciar sesión para
  // ver el coche, lo que cierra el bypass de DevTools.
  let reveal = null;
  if (result.win || (isGameOver && serverKnowsAttempts)) {
    reveal = {
      marca: realCar.marca,
      modelo: realCar.modelo,
      anio: realCar.anio,
      pais: realCar.pais,
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
}
