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

import { readAnonSession, setAnonCookie } from "./_lib/anon-session.js";
import { signRevealToken } from "./_lib/reveal-token.js";
import { getClientIp, rateLimit } from "./_lib/rate-limit.js";
import { captureServerError } from "./_lib/sentry.js";
import { getSupabaseAdmin, getMissingAdminEnvs, createAuthClient } from "./_lib/supabase.js";
import { extractAccessToken, authClientAndUser } from "./_lib/auth.js";
import { todayInMadrid } from "./_lib/date.js";
import { parseBody, methodGuard } from "./_lib/http.js";
import { logGuessAttempt } from "./_lib/audit.js";

const ANIO_CORRECT_MARGIN = 2;
const MAX_ATTEMPTS = 5;
const BASE_POINTS_BY_ATTEMPT = { 1: 10, 2: 6, 3: 4, 4: 3, 5: 2, 6: 1 };

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function basePointsFor(attemptNumber, won) {
  if (!won) return 0;
  return BASE_POINTS_BY_ATTEMPT[attemptNumber] ?? 0;
}

async function fetchCarById(id) {
  const { data, error } = await getSupabaseAdmin()
    .from("cars")
    .select("id, make, model, year, pais, description, description_en")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data;
}

async function persistDailyResult({ accessToken, won, attemptNumber }) {
  const client = accessToken ? createAuthClient(accessToken) : null;
  if (!client) return null;
  const { data, error } = await client.rpc("record_daily_result_v2", {
    p_won: won,
    p_attempt_number: attemptNumber,
  });
  if (error) throw error;
  return data;
}

export default async function handler(req, res) {
  // -------- 0. Método -----------------------------------------------------
  if (methodGuard(req, res, "POST")) return;

  // -------- 0.bis Rate-limit por IP ---------------------------------------
  //   30 hits/min por IP es muy generoso para un humano (un intento tarda
  //   ~3 s de teclear): un jugador normal hace 5 hits en toda la jornada.
  //   El script que itera el catálogo (200 coches) reventará la ventana
  //   a las pocas iteraciones.
  //
  //   Best-effort in-memory: ver api/_lib/rate-limit.js. No cuesta nada
  //   pero un cheater con instancias warmadas distintas podría rotar entre
  //   ellas — para una web pequeña como esta es aceptable.
  const ip = getClientIp(req);
  const limit = rateLimit(`vg:${ip}`, { max: 30, windowMs: 60_000 });
  if (!limit.ok) {
    res.setHeader("Retry-After", String(Math.ceil((limit.resetAt - Date.now()) / 1000)));
    return res.status(429).json({ error: "Too many requests" });
  }

  // -------- TRY/CATCH GLOBAL ---------------------------------------------
  try {
    // -------- 1. Sanity de configuración ---------------------------------
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      console.error(`[validate-guess] missing env vars: ${getMissingAdminEnvs().join(", ")}`);
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
      description_en: realRow.description_en ?? null,
    };

    // -------- 5. attemptNumber AUTORITATIVO server-side -------------------
    //   Logueados: contador desde user_guesses (RLS protegida).
    //   Anónimos:  contador desde cookie HttpOnly firmada con HMAC. Antes
    //              confiábamos en `body.attemptNumber`, lo que permitía a
    //              un script enviar 200 requests con attemptNumber:1 e
    //              iterar todo el catálogo leyendo `result.win`. Con la
    //              cookie, el contador es server-controlled: tras 5
    //              intentos esa sesión queda cerrada, y borrar cookies
    //              fuerza a re-entrar por /api/get-daily-car (que sí emite
    //              cookie pero también queda capada por el rate-limit).
    let attemptNumber;
    let existingGuesses = [];
    let anonSession = null;
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
    } else {
      anonSession = readAnonSession(req);
      // Si no hay cookie válida o es de otro día, rechazamos: el cliente
      // debe pasar por /api/get-daily-car primero (que la emite). En el
      // flujo normal esto siempre ocurre — el frontend llama get-daily-car
      // al arrancar la home.
      if (
        !anonSession ||
        anonSession.d !== today ||
        !Number.isInteger(anonSession.n)
      ) {
        return res.status(400).json({ error: "Anon session missing" });
      }
      if (anonSession.s === "won" || anonSession.s === "lost") {
        return res.status(403).json({ error: "Game already finished" });
      }
      if (anonSession.n >= MAX_ATTEMPTS) {
        return res.status(403).json({ error: "Max attempts reached" });
      }
      attemptNumber = anonSession.n + 1;
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
    //   Política asimétrica intencional según (status, autenticación):
    //
    //   - WIN (logueado o anónimo): revelamos TODO, incluida la
    //     descripción/ficha del coche. El jugador ganó, se merece la
    //     recompensa completa de lore.
    //   - LOST + logueado: revelamos IDENTIDAD (marca/modelo/año/país)
    //     pero NO la descripción. El usuario tiene cuenta, el resultado
    //     queda en su historial — la "trampa del incógnito" no le sirve
    //     porque la pérdida queda registrada. Aprende qué coche era
    //     (necesario para mejorar) pero la ficha completa queda
    //     reservada como recompensa para victorias futuras o repesca
    //     exitosa.
    //   - LOST + anónimo: NO revelamos NADA. Si lo hiciéramos, el cheat
    //     sería trivial: abrir incógnito → fallar adrede los 5 → leer
    //     el coche → cerrar incógnito → jugar con la cuenta real
    //     sabiendo la respuesta. Por eso el anónimo perdedor ve solo la
    //     imagen blurred + overlay de login (renderizado por CarImage).
    //     El ResultPanel pinta el fallback `result.lockedAnswer` cuando
    //     reveal viene null.
    //
    //   Simetría con /api/repesca/validate: ambos endpoints aplican la
    //   misma regla — descripción solo en victoria. Coherencia narrativa
    //   en toda la app.
    const shouldReveal = result.win || (isGameOver && Boolean(user));
    let reveal = null;
    if (shouldReveal) {
      reveal = {
        marca: realCar.marca,
        modelo: realCar.modelo,
        anio: realCar.anio,
        pais: realCar.pais,
        description: result.win ? realCar.description : null,
        description_en: result.win ? realCar.description_en : null,
      };
    }

    // -------- 9.bis Actualizar cookie anónima + emitir revealToken --------
    //   Cookie:    para el anónimo, persistimos el nuevo contador y status.
    //              El próximo intento ya parte del valor server-controlled.
    //   revealToken: token firmado para que el cliente pida la imagen
    //              completa a /api/daily-image. Solo lo emitimos cuando
    //              corresponde revelar (misma regla que `reveal`). Si lo
    //              firmáramos al anónimo perdedor, equivaldría a regalarle
    //              la foto del coche — exactamente el cheat que estamos
    //              cerrando con la asimetría de arriba.
    if (!user && anonSession) {
      try {
        setAnonCookie(res, { d: today, n: attemptNumber, s: newStatus });
      } catch (err) {
        console.error("[validate-guess] setAnonCookie:", err?.message || err);
      }
    }

    let revealToken = null;
    if (shouldReveal) {
      try {
        revealToken = signRevealToken(today);
      } catch (err) {
        console.error("[validate-guess] signRevealToken:", err?.message || err);
      }
    }

    // -------- 9.ter Auditoría oculta (best-effort) -----------------------
    //   Registra cada intento en public.guess_audit para poder detectar el
    //   patrón de oráculo (misma IP sondeando hoy desde sesiones distintas
    //   y luego ganando a la primera). Nunca rompe la respuesta.
    await logGuessAttempt({
      req,
      mode: "daily",
      gameDate: today,
      carId: todayCarId,
      userId: user?.id ?? null,
      isAnon: !user,
      anonN: anonSession?.n ?? null,
      attemptNumber,
      ip,
      guess: { make: guessRow.make, model: guessRow.model, year: guessAnio },
      result,
    });

    return res.status(200).json({
      result,
      win: result.win,
      status: newStatus,
      attemptNumber,
      reveal,
      revealToken,
      score,
    });
  } catch (err) {
    // Cualquier excepción no manejada arriba aterriza aquí: la convertimos
    // en una respuesta JSON 500 en vez de dejar que Vercel devuelva HTML.
    console.error("[validate-guess] UNCAUGHT:", err && err.stack ? err.stack : err);
    await captureServerError(err, { endpoint: "validate-guess" });
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
