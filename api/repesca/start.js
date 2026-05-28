// api/repesca/start.js
// Inicia (o reanuda) una repesca. El SERVIDOR decide qué coche tocará;
// el cliente nunca lo elige.
//
// Contrato del endpoint (POST):
//
//   POST {} (sin carId)
//     → "Arrancar una repesca nueva."
//     - Si ya hay una repesca activa hoy → devuelve esa (idempotente).
//     - Si no hay activa → el server elige un coche al azar de la pool
//       de elegibles del usuario, consume la repesca del día y la devuelve.
//
//   POST { carId: <pseudoId> }
//     → "Estoy en la página /repesca?id=X, dame el estado actual."
//     - Si X coincide con la repesca activa hoy → devuelve estado (idempotente).
//     - Si X no coincide o no hay activa → 409 / 404.
//     - NUNCA arranca una repesca nueva por carId del cliente.
//
// Por qué este diseño:
//   Antes, el cliente elegía el coche con Math.random() en Garage.jsx y
//   enviaba el pseudoCarId. Como el cliente conoce metadatos del pool
//   (país, marca, flag veteran) podía sesgar la "aleatoriedad" hacia
//   coches más fáciles. Mover la elección al servidor con un CSPRNG
//   (crypto.randomInt) cierra ese vector.

import { randomInt } from "node:crypto";
import { pseudoIdFor } from "../_lib/repesca-token.js";
import { getSupabaseAdmin, getMissingAdminEnvs } from "../_lib/supabase.js";
import { requireUser } from "../_lib/auth.js";
import { todayInMadrid } from "../_lib/date.js";
import { parseBody, methodGuard } from "../_lib/http.js";
import { captureServerError } from "../_lib/sentry.js";

// Modo Veterano: si el usuario tiene alguna fila lost previa para este
// coche, significa que ya lo vio revelado al fallar (sea en daily o en
// otra repesca). Entonces la repesca aplica reglas más duras: 1 intento,
// sin pistas progresivas. Mantiene el reto incluso conociendo el coche.
//
// La detección se hace SIEMPRE server-side aquí, en validate y en image,
// para que el cliente no pueda "bajarse" a modo normal manipulando estado.
async function isVeteranMode(authClient, userId, carId) {
  const { data, error } = await authClient
    .from("user_guesses")
    .select("car_id")
    .eq("user_id", userId)
    .eq("car_id", carId)
    .eq("status", "lost")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[repesca/start] isVeteranMode:", error);
    return false; // degradación segura: ante duda, modo normal (más permisivo)
  }
  return !!data;
}

// Lee el estado actual de una partida de repesca (user_guesses) y lo
// formatea para que el cliente lo pinte directamente sin necesitar el
// cars.id real. Usa authClient para que RLS confirme que la fila es del
// usuario (defensa en profundidad — ya validamos auth.uid arriba).
async function readRepescaState(authClient, userId, carId, today) {
  const { data: row, error } = await authClient
    .from("user_guesses")
    .select("guesses, status, car_data")
    .eq("user_id", userId)
    .eq("car_id", carId)
    .eq("date", today)
    .maybeSingle();
  if (error) {
    console.error("[repesca/start] readRepescaState:", error);
    return { guesses: [], status: "playing", reveal: null };
  }
  const status = row?.status || "playing";
  let reveal = null;
  // Reveal cuando la partida está cerrada. Identidad (marca/modelo/año/
  // país) en ambos casos para que el usuario sepa qué falló. Descripción
  // SOLO en victoria — recompensa de lore reservada para wins.
  //
  // NOTA: `car_data` persistido en user_guesses puede contener descripción
  // de partidas históricas (anteriores a esta política). Aquí se filtra
  // en el read, así que tanto rows nuevos como viejos respetan la regla
  // sin necesidad de migrar la tabla.
  //
  // Coherente con /api/validate-guess, /api/repesca/validate y
  // /api/get-daily-car.
  if ((status === "won" || status === "lost") && row?.car_data) {
    const isWon = status === "won";
    reveal = {
      marca: row.car_data.marca,
      modelo: row.car_data.modelo,
      anio: row.car_data.anio,
      pais: row.car_data.pais,
      description: isWon ? (row.car_data.description ?? null) : null,
      description_en: isWon ? (row.car_data.description_en ?? null) : null,
    };
  }
  return {
    guesses: Array.isArray(row?.guesses) ? row.guesses : [],
    status,
    reveal,
  };
}

// Calcula la pool de coches elegibles para repesca de un usuario:
// (coches que fueron daily en el pasado) menos (coches que el usuario ya
// ganó). Se computa entera en el server — el cliente no participa.
//
// Notas RLS:
//   - daily_cars: lectura con getSupabaseAdmin() (service_role). La tabla no
//     debería tener policies de SELECT para authenticated por diseño;
//     todas las lecturas pasan por aquí.
//   - user_guesses: lectura con authClient. RLS confirma que solo
//     leemos filas del propio usuario (defensa en profundidad además
//     del .eq("user_id", userId)).
async function computeEligiblePool(authClient, userId, today) {
  const { data: pastDaily, error: pastErr } = await getSupabaseAdmin()
    .from("daily_cars")
    .select("car_id")
    .lt("date", today);
  if (pastErr) {
    throw new Error(`Failed to load past daily cars: ${pastErr.message}`);
  }
  const pastDailyIds = new Set((pastDaily || []).map((d) => d.car_id));

  const { data: userWins, error: winsErr } = await authClient
    .from("user_guesses")
    .select("car_id")
    .eq("user_id", userId)
    .eq("status", "won");
  if (winsErr) {
    throw new Error(`Failed to load user wins: ${winsErr.message}`);
  }
  const wonIds = new Set((userWins || []).map((w) => w.car_id));

  return [...pastDailyIds].filter((id) => !wonIds.has(id));
}

// Elección uniforme con CSPRNG. Math.random() es entropía PRNG (Mersenne
// Twister o similar): suficiente para juegos casuales, NO para decisiones
// con incentivo de manipular. crypto.randomInt usa rejection sampling y
// es uniforme + criptográficamente seguro.
function pickRandomCryptoSafe(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[randomInt(0, arr.length)];
}

export default async function handler(req, res) {
  if (methodGuard(req, res, "POST")) return;

  try {
    if (!getSupabaseAdmin()) {
      console.error(`[repesca/start] missing env vars: ${getMissingAdminEnvs().join(", ")}`);
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const { user, authClient, error: authError } = await requireUser(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    const body = parseBody(req);
    // carId del cliente es OPCIONAL. Si viene: modo RESUME (validamos contra
    // active). Si no viene: modo NEW START (servidor elige).
    const clientPseudoCarId =
      typeof body.carId === "string" && body.carId.trim()
        ? body.carId.trim()
        : null;

    const today = todayInMadrid();

    // === FASE 1: ¿Hay una repesca activa hoy? ===
    // El servidor es la fuente única de verdad. Esta lectura no se puede
    // saltar ni manipular desde el cliente.
    const { data: statsRow, error: statsErr } = await getSupabaseAdmin()
      .from("stats")
      .select("last_repesca_at, last_repesca_car_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (statsErr) {
      console.error("[repesca/start] read stats:", statsErr);
      return res.status(500).json({ error: "Failed to read stats" });
    }

    const activeCarId =
      statsRow?.last_repesca_at === today ? statsRow?.last_repesca_car_id : null;

    // === FASE 2: Resolver qué coche se va a tocar ===
    let carId;
    let isNewStart;

    if (clientPseudoCarId) {
      // --- MODO RESUME ---
      // El cliente está en /repesca?id=X y nos pide el estado. SOLO
      // respondemos OK si X coincide con la repesca activa hoy. Esto
      // bloquea el vector "URL crafteada con un pseudo arbitrario para
      // arrancar una repesca a la carta": si X no es la activa, error.
      if (!activeCarId) {
        return res.status(404).json({
          error: "No active repesca",
          detail:
            "No tienes ninguna repesca activa hoy. Inicia una nueva desde el garaje.",
        });
      }
      // Verificación directa: derivamos el pseudo del coche activo y
      // comparamos. No hace falta cargar la tabla cars entera para
      // resolveRealCarId — basta con esta comparación O(1).
      const expectedPseudo = pseudoIdFor(activeCarId, user.id);
      if (clientPseudoCarId !== expectedPseudo) {
        return res.status(409).json({
          error: "Repesca mismatch",
          detail:
            "El coche que intentas reanudar no coincide con tu repesca activa de hoy.",
          activeCarId: expectedPseudo, // Lo damos para que el cliente
          // pueda redirigir al activo correcto si quiere.
        });
      }
      carId = activeCarId;
      isNewStart = false;
    } else {
      // --- MODO NEW START ---
      // Cliente no especifica carId → server decide.
      if (activeCarId) {
        // Idempotencia: ya hay una activa, la devolvemos sin consumir.
        // Útil si Garage.jsx fallback re-invoca start (no debería, ya
        // que detecta repescaActiveCarId antes — pero defensivo).
        carId = activeCarId;
        isNewStart = false;
      } else {
        // No hay activa: calculamos pool server-side y elegimos con CSPRNG.
        let pool;
        try {
          pool = await computeEligiblePool(authClient, user.id, today);
        } catch (err) {
          console.error("[repesca/start] computeEligiblePool:", err);
          return res.status(500).json({ error: "Failed to compute pool" });
        }
        if (pool.length === 0) {
          return res.status(404).json({
            error: "No cars to repesca",
            detail: "No tienes coches pendientes para repescar.",
          });
        }
        carId = pickRandomCryptoSafe(pool);
        isNewStart = true;
      }
    }

    // === FASE 3: Modo veterano (siempre server-side) ===
    const veteran = await isVeteranMode(authClient, user.id, carId);
    const mode = veteran ? "veteran" : "normal";
    const maxAttempts = veteran ? 1 : 5;

    // === FASE 4: Consumir la repesca si es un arranque nuevo ===
    // En resume NO tocamos stats (ya se consumió cuando arrancó). En new
    // start escribimos last_repesca_at + last_repesca_car_id atómicamente
    // via upsert.
    if (isNewStart) {
      const { error: upsertErr } = await getSupabaseAdmin()
        .from("stats")
        .upsert(
          {
            user_id: user.id,
            last_repesca_at: today,
            last_repesca_car_id: carId,
          },
          { onConflict: "user_id" }
        );
      if (upsertErr) {
        // Logueamos TODO lo que devuelve Supabase: en logs de Vercel queda
        // el message + code + details + hint. Devolvemos en `detail` el
        // mensaje + código para que la modal del frontend lo muestre y
        // podamos diagnosticar en producción sin tener que abrir logs.
        console.error("[repesca/start] upsert stats:", {
          message: upsertErr.message,
          code: upsertErr.code,
          details: upsertErr.details,
          hint: upsertErr.hint,
        });
        return res.status(500).json({
          error: "Failed to consume repesca",
          detail: `${upsertErr.message}${
            upsertErr.code ? ` (code ${upsertErr.code})` : ""
          }`,
        });
      }
    }

    // === FASE 5: Devolver estado al cliente ===
    // Siempre pseudo carId, nunca real. Mantenemos la propiedad "el
    // cliente nunca conoce el cars.id real de un coche bloqueado".
    const state = await readRepescaState(authClient, user.id, carId, today);

    // LQIP (blur_data) del coche: el placeholder borroso de ~0.5-1 KB que
    // CarImage pinta como fondo mientras descarga la foto real. Devolverlo
    // aquí le da a la repesca el mismo efecto "blur-up → nítida" que el
    // juego principal (identidad visual). No es sensible: es una versión
    // ~24px brutalmente desenfocada, no revela el coche. Si la lectura
    // falla, seguimos sin LQIP (CarImage cae a su skeleton pulsante).
    let blurData = null;
    try {
      const { data: blurRow } = await getSupabaseAdmin()
        .from("cars")
        .select("blur_data")
        .eq("id", carId)
        .maybeSingle();
      blurData = blurRow?.blur_data || null;
    } catch (err) {
      console.error("[repesca/start] read blur_data:", err?.message || err);
    }

    return res.status(200).json({
      ok: true,
      carId: pseudoIdFor(carId, user.id),
      resume: !isNewStart,
      state,
      mode,
      maxAttempts,
      blurData,
    });
  } catch (err) {
    console.error("[repesca/start] UNCAUGHT:", err && err.stack ? err.stack : err);
    await captureServerError(err, { endpoint: "repesca/start" });
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
