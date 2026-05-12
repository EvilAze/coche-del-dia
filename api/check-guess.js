import { createClient } from "@supabase/supabase-js";

const ANIO_CORRECT_MARGIN = 2;
const MAX_ATTEMPTS = 5;

const BASE_POINTS_BY_ATTEMPT = { 1: 10, 2: 6, 3: 4, 4: 3, 5: 2, 6: 1 };

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function basePointsFor(attemptNumber, won) {
  if (!won) return 0;
  return BASE_POINTS_BY_ATTEMPT[attemptNumber] ?? 0;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

async function fetchCarById(id) {
  const { data, error } = await supabase
    .from("cars")
    .select("id, make, model, year, pais, image_url")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data;
}

// Devuelve el país asociado a una marca consultando cualquier coche
// del catálogo que la lleve. Si la marca no existe, devuelve null.
async function fetchPaisForMarca(marca) {
  const normalized = normalize(marca);
  if (!normalized) return null;
  const { data, error } = await supabase
    .from("cars")
    .select("pais")
    .ilike("make", normalized)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.pais ?? null;
}

function extractAccessToken(req) {
  const header = req.headers?.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

async function persistDailyResult({ accessToken, won, attemptNumber }) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !accessToken) return null;

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.rpc("record_daily_result", {
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

  const { guess, carId, attemptNumber } = req.body;
  const { marca, modelo, anio } = guess;

  const realRow = await fetchCarById(carId);
  if (!realRow) {
    return res.status(404).json({ message: "Car not found" });
  }

  const realCar = {
    id: realRow.id,
    marca: realRow.make,
    modelo: realRow.model,
    anio: realRow.year,
    pais: realRow.pais,
    img: realRow.image_url,
  };

  const anioNum = parseInt(anio);
  const diff = Math.abs(anioNum - realCar.anio);
  const anioCorrect = diff <= ANIO_CORRECT_MARGIN;

  const marcaOk = normalize(marca) === normalize(realCar.marca);
  const modeloOk = normalize(modelo) === normalize(realCar.modelo);

  // País del coche real ya viene en la fila. Para el del intento del
  // usuario hace falta otra query (excepto si la marca coincide).
  const realPais = realCar.pais;
  const guessedPais = marcaOk ? realPais : await fetchPaisForMarca(marca);
  const paisOk =
    !marcaOk && guessedPais && realPais && guessedPais === realPais;

  const result = {
    marca: {
      val: marca,
      status: marcaOk ? "correct" : paisOk ? "partial" : "wrong",
      pais: guessedPais,
    },
    modelo: {
      val: modelo,
      status: modeloOk ? "correct" : "wrong",
    },
    anio: {
      val: anio,
      status: anioCorrect ? "correct" : "wrong",
      direction: anioCorrect ? null : anioNum < realCar.anio ? "up" : "down",
    },
    win: marcaOk && modeloOk && anioCorrect,
  };

  const isGameOver = result.win || attemptNumber >= MAX_ATTEMPTS;

  let finalCarData = null;
  if (isGameOver) {
    finalCarData = realCar;
  }

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

  if (isGameOver) {
    const accessToken = extractAccessToken(req);

    if (accessToken) {
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
        console.error("Error recording daily result:", err);
      }
    }
  }

  res.status(200).json({
    result,
    carData: finalCarData,
    score,
  });
}
