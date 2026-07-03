// api/tunel/start.js
// Arranca (o reanuda) una partida del "Túnel de viento" — el modo libre de
// rejugado: el servidor elige al azar un coche que el usuario YA tiene
// desbloqueado en su garaje y se lo sirve desenfocado (no recortado). Sin
// límite diario: al terminar una partida, la siguiente llamada arranca otra.
//
// Contrato del endpoint (POST {}):
//   - Si hay una partida ACTIVA de hoy → la devuelve (idempotente/resume).
//   - Si la última partida quedó abandonada de un día anterior → se cierra
//     como derrota (cuenta en tunel_played) y se arranca una nueva. Sin esto,
//     abandonar a mitad permitiría "descartar" coches difíciles sin coste
//     hasta quedarse solo con los fáciles (skip-scumming del distintivo).
//   - Si no hay activa → pool server-side + CSPRNG y partida nueva.
//
// Decisiones de diseño (el porqué):
//   - POOL = SOLO cromos desbloqueados (wins previas del usuario), menos los
//     ya ganados en el túnel, menos los ganados hace <7 días (demasiado
//     frescos en la memoria). NO se tocan coches bloqueados: ese contenido es
//     territorio exclusivo de la repesca (1/día) y del daily — un modo sin
//     cuota sobre la misma pool canibalizaría la repesca y filtraría
//     identidades de cromos bloqueados en cada derrota.
//   - GATE "primero el diario": solo se puede entrar al túnel con la partida
//     del día terminada. El modo libre es la cola de retención, no el
//     sustituto del hábito diario.
//   - El coche objetivo viaja SIEMPRE como pseudo-id (HMAC por usuario) y la
//     imagen como token AES por-coche: aunque el usuario "conozca" todos sus
//     cromos, saber CUÁL le ha tocado es el juego. El car_id real nunca sale.
//   - Sin puntos, sin racha: la recompensa es el distintivo AERO por cromo
//     (tunel_wins → /api/garage) y los contadores tunel_played/tunel_won.

import { randomInt } from "node:crypto";
import { pseudoIdFor } from "../_lib/repesca-token.js";
import { signImageToken, IMAGE_MODE_GAME_BLUR } from "../_lib/image-token.js";
import { getSupabaseAdmin, getMissingAdminEnvs } from "../_lib/supabase.js";
import { requireUser } from "../_lib/auth.js";
import { todayInMadrid } from "../_lib/date.js";
import { methodGuard, applyCors } from "../_lib/http.js";
import { checkRateLimit } from "../_lib/ratelimit.js";
import { captureServerError } from "../_lib/sentry.js";
import { BLUR_ATTEMPTS } from "../_lib/blur.js";

// Días que un cromo recién ganado queda fuera de la pool. Contra el "lo gané
// ayer, reconozco la foto por el encuadre": el reciclaje funciona con memoria
// fría, no caliente. 7 días equilibra eso con no vaciar pools pequeñas.
const RECENT_WIN_COOLDOWN_DAYS = 7;

// Resta días a una fecha-calendario "YYYY-MM-DD". Aritmética en UTC sobre la
// fecha plana: sin husos ni DST (no hay hora), el resultado es exacto.
function daysBefore(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Elección uniforme con CSPRNG — mismo criterio que repesca/start: hay
// incentivo de manipular el sorteo (elegir coches fáciles), así que nada de
// Math.random().
function pickRandomCryptoSafe(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[randomInt(0, arr.length)];
}

// Suma partidas/victorias a los contadores públicos de stats con
// service_role (INSERT/UPDATE están revocados a authenticated). Best-effort:
// un fallo aquí no debe romper el flujo de juego.
async function bumpCounters(userId, statsRow, { played = 0, won = 0 }) {
  const { error } = await getSupabaseAdmin().from("stats").upsert(
    {
      user_id: userId,
      tunel_played: (statsRow?.tunel_played || 0) + played,
      tunel_won: (statsRow?.tunel_won || 0) + won,
    },
    { onConflict: "user_id" }
  );
  if (error) console.error("[tunel/start] bump counters:", error);
  return {
    played: (statsRow?.tunel_played || 0) + played,
    won: (statsRow?.tunel_won || 0) + won,
  };
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return; // preflight OPTIONS / headers CORS (app Android)
  if (methodGuard(req, res, "POST")) return;

  try {
    if (!getSupabaseAdmin()) {
      console.error(`[tunel/start] missing env vars: ${getMissingAdminEnvs().join(", ")}`);
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const { user, authClient, error: authError } = await requireUser(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    // Rate limit POR USUARIO, no por IP: la app Android sale por CGNAT de
    // operadora (IPs compartidas entre miles de clientes) y el túnel genera
    // más hits legítimos por sesión que el daily. 20/min por identidad es
    // holgado para encadenar partidas y corta scripts.
    const limit = await checkRateLimit(user.id, { max: 20, windowSec: 60, prefix: "ts" });
    if (!limit.ok) {
      res.setHeader("Retry-After", String(limit.retryAfter));
      return res.status(429).json({ error: "Too many requests" });
    }

    const today = todayInMadrid();

    // FASE 1 en paralelo: coche del día (para el gate), partida activa del
    // túnel y contadores. Independientes entre sí.
    const [dailyRpc, gameResult, statsResult] = await Promise.all([
      getSupabaseAdmin().rpc("pick_daily_car", { p_date: today }),
      getSupabaseAdmin()
        .from("tunel_games")
        .select("car_id, date, guesses, status")
        .eq("user_id", user.id)
        .maybeSingle(),
      getSupabaseAdmin()
        .from("stats")
        .select("tunel_played, tunel_won")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const { data: dailyCarId, error: dailyErr } = dailyRpc;
    if (dailyErr || !dailyCarId) {
      console.error("[tunel/start] pick_daily_car:", dailyErr);
      return res.status(500).json({ error: "Failed to resolve daily car" });
    }
    if (gameResult.error) {
      console.error("[tunel/start] read tunel_games:", gameResult.error);
      return res.status(500).json({ error: "Failed to read tunnel state" });
    }
    if (statsResult.error) {
      console.error("[tunel/start] read stats:", statsResult.error);
      // No abortamos: los contadores son cosmética; el juego sigue.
    }
    const prevGame = gameResult.data || null;
    let statsRow = statsResult.data || null;

    // GATE: el diario de hoy tiene que estar cerrado (ganado o perdido).
    // authClient + RLS: leemos solo filas del propio usuario.
    const { data: dailyRow, error: dailyRowErr } = await authClient
      .from("user_guesses")
      .select("status")
      .eq("user_id", user.id)
      .eq("car_id", dailyCarId)
      .eq("date", today)
      .maybeSingle();
    if (dailyRowErr) {
      console.error("[tunel/start] read daily status:", dailyRowErr);
      return res.status(500).json({ error: "Failed to check daily game" });
    }
    const dailyStatus = dailyRow?.status || "playing";
    if (dailyStatus !== "won" && dailyStatus !== "lost") {
      return res.status(403).json({ error: "daily_not_finished" });
    }

    const counters = {
      played: statsRow?.tunel_played || 0,
      won: statsRow?.tunel_won || 0,
    };

    // Helper de respuesta: todo lo que la página /tunel necesita pintar.
    // El token de imagen es por-coche (sin userId) → URL cacheable en CDN.
    // blurData (LQIP ~24px) da el mismo blur-up que el daily/repesca; si la
    // lectura falla seguimos sin él (CarImage cae a su skeleton pulsante).
    const respondGame = async (carId, guesses, resume) => {
      let blurData = null;
      try {
        const { data: blurRow } = await getSupabaseAdmin()
          .from("cars")
          .select("blur_data")
          .eq("id", carId)
          .maybeSingle();
        blurData = blurRow?.blur_data || null;
      } catch (err) {
        console.error("[tunel/start] read blur_data:", err?.message || err);
      }
      return res.status(200).json({
        ok: true,
        resume,
        carId: pseudoIdFor(carId, user.id),
        state: { guesses, status: "playing" },
        img: `/api/car-image?t=${signImageToken({ carId, mode: IMAGE_MODE_GAME_BLUR })}`,
        blurData,
        maxAttempts: BLUR_ATTEMPTS,
        counters,
      });
    };

    // === RESUME: partida de HOY aún en curso ===
    if (prevGame?.status === "playing" && prevGame.date === today) {
      const guesses = Array.isArray(prevGame.guesses) ? prevGame.guesses : [];
      return await respondGame(prevGame.car_id, guesses, true);
    }

    // === Partida abandonada de un día anterior: se cierra como derrota ===
    // (ver cabecera: sin esto, abandonar sería un descarte gratis). La
    // marcamos lost en la tabla ANTES de sobreescribirla para que, si el
    // upsert de la nueva falla, el estado quede coherente.
    if (prevGame?.status === "playing" && prevGame.date < today) {
      const { error: staleErr } = await getSupabaseAdmin()
        .from("tunel_games")
        .update({ status: "lost", updated_at: new Date().toISOString() })
        .eq("user_id", user.id);
      if (staleErr) console.error("[tunel/start] close stale game:", staleErr);
      const bumped = await bumpCounters(user.id, statsRow, { played: 1 });
      statsRow = { tunel_played: bumped.played, tunel_won: bumped.won };
      counters.played = bumped.played;
      counters.won = bumped.won;
    }

    // === PARTIDA NUEVA: pool server-side ===
    // Pool = (cromos ganados por el usuario) − (ya ganados en el túnel)
    //        − (ganados hace <7 días) − (coche del día y último jugado).
    const [winsResult, tunelWinsResult] = await Promise.all([
      authClient
        .from("user_guesses")
        .select("car_id, date")
        .eq("user_id", user.id)
        .eq("status", "won"),
      getSupabaseAdmin()
        .from("tunel_wins")
        .select("car_id")
        .eq("user_id", user.id),
    ]);
    if (winsResult.error) {
      console.error("[tunel/start] read wins:", winsResult.error);
      return res.status(500).json({ error: "Failed to compute pool" });
    }
    if (tunelWinsResult.error) {
      console.error("[tunel/start] read tunel_wins:", tunelWinsResult.error);
      return res.status(500).json({ error: "Failed to compute pool" });
    }

    const winRows = winsResult.data || [];
    const doneIds = new Set((tunelWinsResult.data || []).map((w) => w.car_id));
    const cooldownCutoff = daysBefore(today, RECENT_WIN_COOLDOWN_DAYS);

    // Un mismo coche puede tener varias filas won (daily + repesca de otro
    // día); dedupe quedándonos con la fecha MÁS RECIENTE para el cooldown.
    const latestWinByCar = new Map();
    for (const w of winRows) {
      const prev = latestWinByCar.get(w.car_id);
      if (!prev || w.date > prev) latestWinByCar.set(w.car_id, w.date);
    }

    const pool = [...latestWinByCar.entries()]
      .filter(([carId, wonDate]) =>
        !doneIds.has(carId) &&
        wonDate < cooldownCutoff &&
        carId !== dailyCarId &&
        carId !== prevGame?.car_id
      )
      .map(([carId]) => carId);

    if (pool.length === 0) {
      // Distinguimos el porqué para que el cliente elija la copy adecuada:
      // sin cromos aún / túnel completado / todo en enfriamiento.
      const reason =
        latestWinByCar.size === 0
          ? "no_cars"
          : [...latestWinByCar.keys()].every((id) => doneIds.has(id))
          ? "all_done"
          : "cooldown";
      return res.status(200).json({ ok: true, empty: true, reason, counters });
    }

    const carId = pickRandomCryptoSafe(pool);

    // Upsert (PK user_id): la fila anterior — ya cerrada — se sobreescribe.
    // Las derrotas del túnel jamás acumulan filas; solo mueven contadores.
    const { error: upsertErr } = await getSupabaseAdmin()
      .from("tunel_games")
      .upsert(
        {
          user_id: user.id,
          car_id: carId,
          date: today,
          guesses: [],
          status: "playing",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    if (upsertErr) {
      console.error("[tunel/start] upsert tunel_games:", {
        message: upsertErr.message,
        code: upsertErr.code,
        details: upsertErr.details,
        hint: upsertErr.hint,
      });
      return res.status(500).json({
        error: "Failed to start tunnel game",
        detail: `${upsertErr.message}${upsertErr.code ? ` (code ${upsertErr.code})` : ""}`,
      });
    }

    return await respondGame(carId, [], false);
  } catch (err) {
    console.error("[tunel/start] UNCAUGHT:", err && err.stack ? err.stack : err);
    await captureServerError(err, { endpoint: "tunel/start" });
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
