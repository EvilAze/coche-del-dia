import { createClient } from "@supabase/supabase-js";
import { CARS, MARCA_PAIS } from "../src/data/cars";

const ANIO_CORRECT_MARGIN = 2;
const MAX_ATTEMPTS = 5;

const BASE_POINTS_BY_ATTEMPT = { 1: 10, 2: 6, 3: 4, 4: 3, 5: 2, 6: 1 };

function basePointsFor(attemptNumber, won) {
  if (!won) return 0;
  return BASE_POINTS_BY_ATTEMPT[attemptNumber] ?? 0;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function getPaisByMarca(marca) {
  const normalized = normalize(marca);
  const canonicalMarca = Object.keys(MARCA_PAIS).find(
    (m) => normalize(m) === normalized
  );

  return canonicalMarca ? MARCA_PAIS[canonicalMarca] : null;
}

function extractAccessToken(req) {
  const header = req.headers?.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

async function persistDailyResult({ accessToken, won, attemptNumber }) {
  const url =
    process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;

  if (!url || !anonKey || !accessToken) return null;

  const client = createClient(url, anonKey, {
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

  const realCar = CARS[carId];

  if (!realCar) {
    return res.status(404).json({ message: "Car not found" });
  }

  const anioNum = parseInt(anio);
  const diff = Math.abs(anioNum - realCar.anio);
  const anioCorrect = diff <= ANIO_CORRECT_MARGIN;

  const marcaOk = normalize(marca) === normalize(realCar.marca);
  const modeloOk = normalize(modelo) === normalize(realCar.modelo);

  const guessedPais = getPaisByMarca(marca);
  const realPais = realCar.pais || getPaisByMarca(realCar.marca);
  const paisOk = !marcaOk && guessedPais && realPais && guessedPais === realPais;

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
    finalCarData = {
      ...realCar,
      img: `/coches/${carId}.jpg`,
    };
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
