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

import { readAnonToken, signAnonSession } from "./_lib/anon-session.js";
import { signRevealToken } from "./_lib/reveal-token.js";
import { getClientIp } from "./_lib/ratelimit.js";
import { checkRateLimit } from "./_lib/ratelimit.js";
import { captureServerError } from "./_lib/sentry.js";
import { getSupabaseAdmin, getMissingAdminEnvs, createAuthClient } from "./_lib/supabase.js";
import { extractAccessToken, authClientAndUser } from "./_lib/auth.js";
import { todayInMadrid } from "./_lib/date.js";
import { parseBody, methodGuard, applyCors } from "./_lib/http.js";
import { logGuessAttempt } from "./_lib/audit.js";
import { compareGuess } from "./_lib/compare-guess.js";
import { basePointsFor } from "./_lib/score.js";

const MAX_ATTEMPTS = 5;

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
  if (applyCors(req, res)) return; // preflight OPTIONS / headers CORS
  // -------- 0. Método -----------------------------------------------------
  if (methodGuard(req, res, "POST")) return;

  // -------- 0.bis Rate-limit por IP ---------------------------------------
  //   30 hits/min por IP es muy generoso para un humano (un intento tarda
  //   ~3 s de teclear): un jugador normal hace 5 hits en toda la jornada.
  //   El script que itera el catálogo (200 coches) reventará la ventana
  //   a las pocas iteraciones.
  //
  //   Distribuido (Upstash) y por tanto compartido entre instancias: rotar
  //   entre lambdas warm ya no lo esquiva. Es FAIL-OPEN a propósito — si
  //   Upstash cae, se juega sin limiter antes que romper la partida. Detalle
  //   completo en api/_lib/ratelimit.js.
  const ip = getClientIp(req);
  const limit = await checkRateLimit(ip, { max: 30, windowSec: 60, prefix: "vg" });
  if (!limit.ok) {
    res.setHeader("Retry-After", String(limit.retryAfter));
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
    //   Anónimos:  contador desde token HMAC en header X-Anon-Session. Antes
    //              confiábamos en `body.attemptNumber`, lo que permitía a
    //              un script enviar 200 requests con attemptNumber:1 e
    //              iterar todo el catálogo leyendo `result.win`. Con el
    //              token, el contador es server-controlled: tras 5
    //              intentos esa sesión queda cerrada, y borrar el token
    //              fuerza a re-entrar por /api/get-daily-car (que lo emite
    //              de nuevo, pero también queda capado por el rate-limit).
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
      anonSession = readAnonToken(req);
      // Si no hay token válido o es de otro día, rechazamos: el cliente
      // debe pasar por /api/get-daily-car primero (que lo emite). En el
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
    //   Función pura en _lib/compare-guess.js (testeada en Vitest).
    const result = compareGuess({ realCar, guessRow, guessAnio });

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
            // (Aquí viajaban `freezeUsed` y `streakFreezes`, del escudo de racha.
            // La mecánica se retiró en agosto de 2026 —ver
            // scripts/2026-08-retirar-escudo-racha.sql— y el RPC ya no las
            // devuelve. Nadie las pintaba: el fin de partida del daily no tiene
            // panel de puntuación, así que el escudo se gastaba en silencio.)
            persisted: true,
          };
        }
      } catch (err) {
        // No reventamos la respuesta principal: solo logueamos.
        console.error("[validate-guess] persistDailyResult:", err);
      }
    }

    // -------- 8.bis Daily stats (best-effort) ----------------------------
    //   Incrementa los contadores agregados del día para el componente
    //   DailyStats (distribución de intentos, win rate, etc.). Se ejecuta
    //   para TODOS los jugadores (logueados y anónimos) porque las stats
    //   globales necesitan representar a toda la audiencia.
    //   Best-effort: si falla, no afecta al resultado de la partida.
    if (isGameOver) {
      try {
        await supabaseAdmin.rpc("increment_daily_stats", {
          p_date: today,
          p_won: result.win,
          p_attempt: attemptNumber,
        });
      } catch (err) {
        console.error("[validate-guess] increment_daily_stats:", err);
      }
    }

    // -------- 9. Política de revelado ------------------------------------
    //   Con la partida CERRADA revelamos siempre la IDENTIDAD del coche
    //   (marca/modelo/año/país), gane o pierda, esté logueado o no. La
    //   DESCRIPCIÓN/ficha sigue siendo recompensa exclusiva de la victoria
    //   (simetría con /api/repesca/validate).
    //
    //   POR QUÉ SE QUITÓ EL MURO AL ANÓNIMO PERDEDOR (jul-2026):
    //   la versión anterior no revelaba NADA al anónimo que perdía —foto
    //   emborronada + "inicia sesión para verla"— para cerrar este cheat:
    //   abrir incógnito → fallar adrede los 5 → leer el coche → volver a
    //   la cuenta real sabiendo la respuesta.
    //
    //   El muro no cerraba ese cheat: LOST + logueado YA revelaba la
    //   identidad, así que al tramposo le bastaba una segunda cuenta de
    //   Google (gratis e ilimitadas) para el mismo resultado. Lo único que
    //   añadía era el coste de crearla — trivial y de una sola vez para
    //   quien quiere hacer trampa, permanente para todo recién llegado.
    //
    //   Y el precio era el peor posible: el visitante nuevo que llega de un
    //   grupo de Telegram, pierde su primera partida y, en lugar del pago
    //   emocional del juego ("ah, era un Volvo S60"), se encuentra un muro
    //   de OAuth que además se lee como castigo por haber fallado. Primero
    //   se da, luego se pide: el EndScreen le ofrece guardar el progreso
    //   DESPUÉS de enseñarle el coche.
    const shouldReveal = result.win || isGameOver;
    let reveal = null;
    if (shouldReveal) {
      reveal = {
        marca: realCar.marca,
        modelo: realCar.modelo,
        anio: realCar.anio,
        pais: realCar.pais,
        // La ficha de lore, solo al que gana (en derrota van a null y el
        // EndScreen simplemente no pinta la nota).
        description: result.win ? realCar.description ?? null : null,
        description_en: result.win ? realCar.description_en ?? null : null,
      };
    }

    // -------- 9.bis Actualizar token anónimo + emitir revealToken ----------
    //   Token:     para el anónimo, firmamos el nuevo contador y status
    //              y lo devolvemos en el body (anonToken). El cliente lo
    //              persiste en localStorage y lo reenvía en el próximo intento.
    //   revealToken: token firmado para que el cliente pida la imagen
    //              completa a /api/daily-image. Misma regla que `reveal`:
    //              con la partida cerrada, la foto entera. Enseñar el nombre
    //              del coche y seguir escondiendo su foto sería lo peor de
    //              los dos mundos — el jugador ya sabe qué era y el recorte
    //              solo le niega el remate visual de su propia partida.
    // Token anónimo actualizado: lo devolvemos en el body (antes era Set-Cookie).
    // El cliente lo persiste en localStorage y lo reenvía en el próximo intento.
    let anonToken = null;
    if (!user && anonSession) {
      try {
        anonToken = signAnonSession({ d: today, n: attemptNumber, s: newStatus });
      } catch (err) {
        console.error("[validate-guess] signAnonSession:", err?.message || err);
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
      anonToken,
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
