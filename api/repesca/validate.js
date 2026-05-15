// api/repesca/validate.js
// Validación de un intento en modo repesca. Diferencias clave respecto a
// /api/validate-guess (modo daily):
//   - El coche objetivo NO se resuelve con pick_daily_car: lo dicta el
//     usuario, pero gateado por su `stats.last_repesca_at` + `last_repesca_car_id`.
//   - Persistencia en user_guesses con (user_id, car_id, date=hoy), igual
//     que daily — pero como car_id != coche del día, no hay conflicto.
//   - Scoring: la MITAD de los puntos normales, redondeo hacia arriba.
//   - NO se llama a record_daily_result_v2 → no se toca current_streak,
//     max_streak ni last_played_date. Solo se suman points y total_wins
//     directamente sobre `stats`.

import { createClient } from "@supabase/supabase-js";

const ANIO_CORRECT_MARGIN = 2;
const MAX_ATTEMPTS = 5;
const BASE_POINTS_BY_ATTEMPT = { 1: 10, 2: 6, 3: 4, 4: 3, 5: 2, 6: 1 };

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

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

// Puntos base de la repesca = mitad de los daily, redondeo hacia arriba
// (para que el intento 5 = 1 punto y no 0). Sigue siendo significativamente
// menor que el daily.
function repescaPointsFor(attemptNumber, won) {
  if (!won) return 0;
  const base = BASE_POINTS_BY_ATTEMPT[attemptNumber] ?? 0;
  return Math.ceil(base / 2);
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
    console.error("[repesca/validate] authClientAndUser:", err);
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
    const guessCarId =
      typeof body.guessCarId === "string" ? body.guessCarId.trim() : "";
    const guessAnio = body.anio;

    if (!UUID_RE.test(carId)) {
      return res.status(400).json({ error: "Invalid carId (target)" });
    }
    if (!UUID_RE.test(guessCarId)) {
      return res.status(400).json({ error: "Invalid guessCarId" });
    }
    if (guessAnio === undefined || guessAnio === null) {
      return res.status(400).json({ error: "Invalid anio" });
    }

    const today = todayInMadrid();

    // 1) Gate: el usuario debe tener una repesca activa HOY para este carId.
    const { data: statsRow, error: statsErr } = await authClient
      .from("stats")
      .select(
        "last_repesca_at, last_repesca_car_id, total_points, total_wins"
      )
      .eq("user_id", user.id)
      .maybeSingle();
    if (statsErr) {
      console.error("[repesca/validate] read stats:", statsErr);
      return res.status(500).json({ error: "Failed to check repesca" });
    }
    const repescaActive =
      statsRow?.last_repesca_at === today &&
      statsRow?.last_repesca_car_id === carId;
    if (!repescaActive) {
      return res.status(403).json({ error: "Repesca not active for this car" });
    }

    // 2) Cargar coche-real (objetivo) y coche-guess.
    const [realRow, guessRow] = await Promise.all([
      fetchCarById(carId),
      fetchCarById(guessCarId),
    ]);
    if (!realRow) {
      return res.status(500).json({ error: "Target car missing in catalog" });
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

    // 3) Número de intento server-side. Leemos la fila de user_guesses
    //    para (user_id, car_id, date=hoy) — única para esta repesca.
    const { data: row, error: rowErr } = await authClient
      .from("user_guesses")
      .select("guesses, status")
      .eq("user_id", user.id)
      .eq("car_id", carId)
      .eq("date", today)
      .maybeSingle();
    if (rowErr) {
      console.error("[repesca/validate] read user_guesses:", rowErr);
      return res.status(500).json({ error: "Failed to read attempts" });
    }
    if (row?.status === "won" || row?.status === "lost") {
      return res.status(403).json({ error: "Repesca already finished" });
    }
    const existingGuesses = Array.isArray(row?.guesses) ? row.guesses : [];
    if (existingGuesses.length >= MAX_ATTEMPTS) {
      return res.status(403).json({ error: "Max attempts reached" });
    }
    const attemptNumber = existingGuesses.length + 1;

    // 4) Comparación (idéntica a /api/validate-guess).
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

    // 5) Persistencia autoritativa en user_guesses. Misma forma que daily
    //    para que el garaje detecte el win sin cambios.
    const newGuesses = [...existingGuesses, result];
    const { error: saveErr } = await authClient.from("user_guesses").upsert(
      {
        user_id: user.id,
        car_id: carId,
        date: today,
        guesses: newGuesses,
        status: newStatus,
        car_data: isGameOver ? { ...realCar, id: carId } : null,
      },
      { onConflict: "user_id,car_id,date" }
    );
    if (saveErr) {
      console.error("[repesca/validate] save user_guesses:", saveErr);
    }

    // 6) Scoring de repesca: SOLO al ganar, suma MITAD de puntos y +1 win.
    //    NO se toca current_streak, max_streak ni last_played_date — esos
    //    pertenecen al modo daily exclusivamente.
    const points = repescaPointsFor(attemptNumber, result.win);
    let score = {
      basePoints: points,
      streakBonus: 0,
      totalPoints: points,
      currentStreak: null,
      maxStreak: null,
      totalScore: null,
      persisted: false,
      isRepesca: true,
    };

    if (result.win && points > 0) {
      const nextTotal = (statsRow?.total_points || 0) + points;
      const nextWins = (statsRow?.total_wins || 0) + 1;
      const { error: pointsErr } = await authClient
        .from("stats")
        .upsert(
          {
            user_id: user.id,
            total_points: nextTotal,
            total_wins: nextWins,
          },
          { onConflict: "user_id" }
        );
      if (pointsErr) {
        console.error("[repesca/validate] update stats:", pointsErr);
        // No abortamos: el cliente recibe el resultado igualmente.
      } else {
        score = {
          ...score,
          totalScore: nextTotal,
          persisted: true,
        };
      }
    }

    // 7) Política de revelado: misma que daily. Ganar SIEMPRE revela;
    //    perder en juego servidor-validado también revela (todo logueado).
    let reveal = null;
    if (result.win || isGameOver) {
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
      status: newStatus,
      attemptNumber,
      reveal,
      score,
      mode: "repesca",
    });
  } catch (err) {
    console.error("[repesca/validate] UNCAUGHT:", err && err.stack ? err.stack : err);
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
