import { createClient } from "@supabase/supabase-js";

const ANIO_CORRECT_MARGIN = 2;
const MAX_ATTEMPTS = 5;

const BASE_POINTS_BY_ATTEMPT = { 1: 10, 2: 6, 3: 4, 4: 3, 5: 2, 6: 1 };

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
// service_role bypassea RLS. NO en cliente. Necesario porque image_url no
// es legible con anon tras el hardening.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Cliente anon: lecturas de columnas públicas + RPCs granted a anon.
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Cliente service_role: solo para leer columnas restringidas como image_url.
const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

function basePointsFor(attemptNumber, won) {
  if (!won) return 0;
  return BASE_POINTS_BY_ATTEMPT[attemptNumber] ?? 0;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

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

// Crea un cliente Supabase autenticado con el JWT del usuario, o null si no
// hay token válido.
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
  // Lee image_url, que está revocado para anon → usa service_role.
  const client = supabaseAdmin || supabase;
  const { data, error } = await client
    .from("cars")
    .select("id, make, model, year, pais, image_url")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data;
}

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

async function persistDailyResult({ accessToken, won, attemptNumber }) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !accessToken) return null;

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // record_daily_result_v2 es el wrapper que valida los params contra
  // user_guesses antes de delegar en la función original. La función vieja
  // tiene EXECUTE revocado de authenticated, así que cualquier llamada
  // directa desde el navegador a record_daily_result fallará.
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

  // -------- 1. Validación de input -----------------------------------------
  const body = req.body || {};
  const guess = body.guess;
  if (
    !guess ||
    typeof guess.marca !== "string" ||
    typeof guess.modelo !== "string" ||
    guess.anio === undefined ||
    guess.anio === null
  ) {
    return res.status(400).json({ message: "Invalid guess payload" });
  }

  const today = todayInMadrid();
  const accessToken = extractAccessToken(req);
  const { user } = await authClientAndUser(accessToken);

  // -------- 2. [C2] Servidor decide cuál es el coche del día ---------------
  //   Antes: el cliente mandaba carId en el body y se aceptaba sin más.
  //   Ahora: lo resolvemos de daily_cars vía pick_daily_car. El carId del
  //   body se ignora a propósito; solo lo aceptamos como sanity check
  //   opcional para detectar clientes desincronizados.
  const { data: todayCarId, error: pickErr } = await supabase.rpc(
    "pick_daily_car",
    { p_date: today }
  );
  if (pickErr || !todayCarId) {
    console.error("[check-guess] pick_daily_car:", pickErr);
    return res.status(500).json({ message: "Failed to resolve daily car" });
  }

  if (body.carId && body.carId !== todayCarId) {
    // El cliente está pidiendo otro coche. Posible cache desincronizada o
    // intento de manipulación. Respondemos con 409 para que recargue.
    return res.status(409).json({
      message: "Stale car id, please reload",
      currentId: todayCarId,
    });
  }

  const realRow = await fetchCarById(todayCarId);
  if (!realRow) {
    return res.status(500).json({ message: "Daily car missing in catalog" });
  }
  const realCar = {
    id: realRow.id,
    marca: realRow.make,
    modelo: realRow.model,
    anio: realRow.year,
    pais: realRow.pais,
    img: realRow.image_url,
  };

  // -------- 3. [C1] Servidor decide el número de intento --------------------
  //   Para usuarios logueados: leemos la fila existente de user_guesses.
  //   Para anónimos: no tenemos estado server-side; aceptamos el body pero
  //   limitamos qué se revela (más abajo).
  let attemptNumber;
  let serverKnowsAttempts;
  let existingGuesses = [];
  if (user) {
    const { data: row, error: rowErr } = await supabase
      .from("user_guesses")
      .select("guesses, status")
      .eq("user_id", user.id)
      .eq("car_id", todayCarId)
      .eq("date", today)
      .maybeSingle();
    if (rowErr) {
      console.error("[check-guess] read user_guesses:", rowErr);
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

  // -------- 4. Validar el guess contra el coche real -----------------------
  const { marca, modelo, anio } = guess;
  const anioNum = parseInt(anio);
  const anioCorrect =
    Number.isFinite(anioNum) &&
    Math.abs(anioNum - realCar.anio) <= ANIO_CORRECT_MARGIN;

  const marcaOk = normalize(marca) === normalize(realCar.marca);
  const modeloOk = normalize(modelo) === normalize(realCar.modelo);

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

  // -------- 5. [C1] Política de revelado de carData ------------------------
  //   - Victoria real (validada en servidor): siempre se revela.
  //   - Derrota tras MAX_ATTEMPTS para usuarios LOGUEADOS: revela (el server
  //     verificó los intentos contra user_guesses, no se puede saltar).
  //   - Derrota para ANÓNIMOS: NO se revela. Si un anónimo quiere ver la
  //     respuesta tras perder, tiene que iniciar sesión. Esto evita el viejo
  //     ataque de mandar attemptNumber:5 para obtener carData sin jugar.
  let finalCarData = null;
  if (result.win) {
    finalCarData = realCar;
  } else if (isGameOver && serverKnowsAttempts) {
    finalCarData = realCar;
  }

  // -------- 6. Puntuación + persistencia (solo si terminó la partida) ------
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

  // -------- 6b. [C1+C4] Persistencia autoritativa de user_guesses ----------
  //   El cliente ya no escribe en user_guesses; lo hacemos aquí con los
  //   valores que el servidor ha validado. Sin esto, un atacante podría
  //   nunca llamar al upsert del cliente y "reintentar" infinitas veces.
  if (user && accessToken) {
    const newGuesses = [...existingGuesses, result];
    const newStatus = result.win
      ? "won"
      : newGuesses.length >= MAX_ATTEMPTS
      ? "lost"
      : "playing";

    // Usamos el cliente autenticado (Bearer del usuario). La RLS debe
    // permitir UPSERT solo en filas donde user_id = auth.uid().
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: saveErr } = await authClient.from("user_guesses").upsert(
      {
        user_id: user.id,
        car_id: todayCarId,
        date: today,
        guesses: newGuesses,
        status: newStatus,
        car_data: result.win || newStatus === "lost" ? realCar : null,
      },
      { onConflict: "user_id,car_id,date" }
    );
    if (saveErr) {
      console.error("[check-guess] save user_guesses:", saveErr);
      // No abortamos: el cliente recibe el resultado igualmente, pero
      // sin persistencia. Mejor degradación que romper el juego.
    }
  }

  if (isGameOver && user && accessToken) {
    try {
      const persisted = await persistDailyResult({
        accessToken,
        won: result.win, // server-validated, no es lo que mande el cliente
        attemptNumber,   // server-derived, idem
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
      console.error("[check-guess] persistDailyResult:", err);
    }
  }

  res.status(200).json({
    result,
    carData: finalCarData,
    score,
  });
}
