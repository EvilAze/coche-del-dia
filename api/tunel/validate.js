// api/tunel/validate.js
// Validación de un intento en el Túnel de viento. Diferencias clave respecto
// a repesca/validate:
//   - El cliente NO manda el carId objetivo: el objetivo es, por definición,
//     la partida activa en tunel_games. Menos superficie de ataque (no hay
//     pseudo que resolver ni mismatch posible) y una query menos.
//   - CERO puntos y CERO racha: el túnel no toca total_points, total_wins ni
//     streaks. Economías separadas a propósito — la recompensa del túnel es
//     el distintivo AERO (tunel_wins) y los contadores tunel_played/won.
//     Efecto lateral deliberado: sin puntos, farmear el túnel con scripts no
//     infla ningún ranking.
//   - Persistencia en tunel_games (una fila por usuario, se sobreescribe):
//     las derrotas nunca acumulan filas.

import { getSupabaseAdmin, getMissingAdminEnvs } from "../_lib/supabase.js";
import { signImageToken, IMAGE_MODE_CLEAR } from "../_lib/image-token.js";
import { requireUser } from "../_lib/auth.js";
import { todayInMadrid } from "../_lib/date.js";
import { parseBody, methodGuard, applyCors } from "../_lib/http.js";
import { checkRateLimit } from "../_lib/ratelimit.js";
import { getClientIp } from "../_lib/rate-limit.js";
import { captureServerError } from "../_lib/sentry.js";
import { logGuessAttempt } from "../_lib/audit.js";
import { compareGuess } from "../_lib/compare-guess.js";
import { BLUR_ATTEMPTS } from "../_lib/blur.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchCarById(id) {
  const { data, error } = await getSupabaseAdmin()
    .from("cars")
    .select("id, make, model, year, pais, description, description_en")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return; // preflight OPTIONS / headers CORS (app Android)
  if (methodGuard(req, res, "POST")) return;

  try {
    if (!getSupabaseAdmin()) {
      console.error(`[tunel/validate] missing env vars: ${getMissingAdminEnvs().join(", ")}`);
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const { user, error: authError } = await requireUser(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    // Rate limit por identidad, no por IP (CGNAT móvil): 30/min cubre de
    // sobra a un humano encadenando partidas (un intento tarda ~3 s).
    const limit = await checkRateLimit(user.id, { max: 30, windowSec: 60, prefix: "tv" });
    if (!limit.ok) {
      res.setHeader("Retry-After", String(limit.retryAfter));
      return res.status(429).json({ error: "Too many requests" });
    }

    const body = parseBody(req);
    const guessCarId =
      typeof body.guessCarId === "string" ? body.guessCarId.trim() : "";
    const guessAnio = body.anio;
    if (!UUID_RE.test(guessCarId)) {
      return res.status(400).json({ error: "Invalid guessCarId" });
    }
    if (guessAnio === undefined || guessAnio === null) {
      return res.status(400).json({ error: "Invalid anio" });
    }

    const today = todayInMadrid();

    // 1) Gate: partida activa HOY. tunel_games es deny-all para el cliente;
    //    esta lectura service_role es la única fuente de verdad del objetivo.
    const { data: game, error: gameErr } = await getSupabaseAdmin()
      .from("tunel_games")
      .select("car_id, date, guesses, status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (gameErr) {
      console.error("[tunel/validate] read tunel_games:", gameErr);
      return res.status(500).json({ error: "Failed to read tunnel game" });
    }
    if (!game || game.status !== "playing" || game.date !== today) {
      // Cubre: sin partida, partida ya cerrada y partida rancia de otro día
      // (esa la cierra /start al reanudar — aquí solo la rechazamos).
      return res.status(403).json({ error: "No active tunnel game" });
    }

    const existingGuesses = Array.isArray(game.guesses) ? game.guesses : [];
    if (existingGuesses.length >= BLUR_ATTEMPTS) {
      return res.status(403).json({ error: "Max attempts reached" });
    }
    const attemptNumber = existingGuesses.length + 1;

    // 2) Coche objetivo y coche del intento, en paralelo.
    const [realRow, guessRow] = await Promise.all([
      fetchCarById(game.car_id),
      fetchCarById(guessCarId),
    ]);
    if (!realRow) {
      console.error("[tunel/validate] target car missing:", game.car_id);
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
      description_en: realRow.description_en ?? null,
    };

    // 3) Comparación: la MISMA función pura que el daily (contrato del
    //    objeto result con GuessRow/AttemptRow — no divergen).
    const result = compareGuess({ realCar, guessRow, guessAnio });

    const isGameOver = result.win || attemptNumber >= BLUR_ATTEMPTS;
    const newStatus = result.win ? "won" : isGameOver ? "lost" : "playing";
    const newGuesses = [...existingGuesses, result];

    // 4) Persistencia autoritativa (service_role; el cliente no puede
    //    escribir tunel_games). Un fallo aquí sí aborta: sin estado guardado
    //    el usuario podría repetir el intento infinitas veces.
    const { error: saveErr } = await getSupabaseAdmin()
      .from("tunel_games")
      .update({
        guesses: newGuesses,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);
    if (saveErr) {
      console.error("[tunel/validate] save tunel_games:", saveErr);
      return res.status(500).json({ error: "Failed to save attempt" });
    }

    // 5) Cierre de partida: contadores + distintivo. Best-effort (el
    //    resultado ya está persistido; esto es la recompensa).
    let counters = null;
    if (isGameOver) {
      const { data: statsRow, error: statsErr } = await getSupabaseAdmin()
        .from("stats")
        .select("tunel_played, tunel_won")
        .eq("user_id", user.id)
        .maybeSingle();
      if (statsErr) console.error("[tunel/validate] read stats:", statsErr);
      counters = {
        played: (statsRow?.tunel_played || 0) + 1,
        won: (statsRow?.tunel_won || 0) + (result.win ? 1 : 0),
      };
      const { error: bumpErr } = await getSupabaseAdmin().from("stats").upsert(
        {
          user_id: user.id,
          tunel_played: counters.played,
          tunel_won: counters.won,
        },
        { onConflict: "user_id" }
      );
      if (bumpErr) console.error("[tunel/validate] bump counters:", bumpErr);

      if (result.win) {
        // PK (user_id, car_id): re-ganar un coche que ya tuviera distintivo
        // (no debería pasar — la pool lo excluye) no duplica fila.
        const { error: winErr } = await getSupabaseAdmin()
          .from("tunel_wins")
          .upsert(
            {
              user_id: user.id,
              car_id: game.car_id,
              won_at: today,
              attempts: attemptNumber,
            },
            { onConflict: "user_id,car_id" }
          );
        if (winErr) console.error("[tunel/validate] upsert tunel_wins:", winErr);
      }
    }

    // 6) Revelado al cerrar: identidad en ambos casos (el usuario ya conoce
    //    este coche — es un cromo suyo); descripción solo en victoria, la
    //    misma política de "lore como recompensa" del resto de modos. La
    //    imagen nítida viaja como token clear (302 al CDN) — el mismo que ya
    //    tiene en su garaje para este coche, así que no filtra nada nuevo.
    let reveal = null;
    let revealImg = null;
    if (isGameOver) {
      reveal = {
        marca: realCar.marca,
        modelo: realCar.modelo,
        anio: realCar.anio,
        pais: realCar.pais,
        description: result.win ? realCar.description : null,
        description_en: result.win ? realCar.description_en : null,
      };
      try {
        revealImg = `/api/car-image?t=${signImageToken({
          carId: game.car_id,
          mode: IMAGE_MODE_CLEAR,
        })}`;
      } catch (err) {
        console.error("[tunel/validate] sign reveal token:", err?.message || err);
      }
    }

    // Auditoría oculta (best-effort): misma tabla que daily/repesca.
    await logGuessAttempt({
      req,
      mode: "tunel",
      gameDate: today,
      carId: game.car_id,
      userId: user.id,
      isAnon: false,
      anonN: null,
      attemptNumber,
      ip: getClientIp(req),
      guess: { make: guessRow.make, model: guessRow.model, year: guessAnio },
      result,
    });

    return res.status(200).json({
      result,
      win: result.win,
      status: newStatus,
      attemptNumber,
      maxAttempts: BLUR_ATTEMPTS,
      reveal,
      revealImg,
      counters,
    });
  } catch (err) {
    console.error("[tunel/validate] UNCAUGHT:", err && err.stack ? err.stack : err);
    await captureServerError(err, { endpoint: "tunel/validate" });
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
