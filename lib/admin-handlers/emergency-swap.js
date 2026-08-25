// lib/admin-handlers/emergency-swap.js
// Cambio de emergencia del coche del día: sustituir el coche de HOY con la
// jornada ya empezada.
//
// Por qué tiene endpoint propio y no es un flag del POST del calendario: el
// swap normal reemplaza una asignación que nadie ha jugado. Este tiene que
// preservar las partidas en curso, así que guarda el coche saliente en
// daily_cars.prev_car_ids — de ahí sale el «quien ya jugaba se queda con el
// suyo» que implementa api/_lib/coche-de-hoy.js. Un camino distinto para una
// acción distinta, y explícito: a hoy no se llega por descuido.
//
// GET  → { today, car, jugadores: { logueados, anonimos } }
//        El recuento es para el modal: enseñar a cuánta gente afecta ANTES de
//        pulsar. Si falla, se devuelve null y el panel lo dice — un número
//        inventado sería peor que ninguno.
// POST → { car_id }  Cambia el coche y devuelve { car, prevCarIds }.
//
// Seguridad: requireAdmin (whitelist por email). Toda la mutación con
// service_role; daily_cars está revocada para anon/authenticated.

import { getSupabaseAdmin, getMissingAdminEnvs } from "../../api/_lib/supabase.js";
import { requireAdmin } from "../../api/_lib/auth.js";
import { parseBody, methodGuard } from "../../api/_lib/http.js";
import { todayInMadrid } from "../../api/_lib/date.js";
import { versionDeImagen } from "../../api/_lib/version-imagen.js";
import { clampZoomBase } from "../../api/_lib/zoom.js";
import { writeEdgeConfig } from "../../api/_lib/cron/warm-daily.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shapeCar(row) {
  if (!row) return null;
  return {
    id: row.id,
    marca: row.make,
    modelo: row.model,
    anio: row.year,
    pais: row.pais,
    image_url: row.image_url ?? null,
  };
}

export default async function handler(req, res) {
  if (methodGuard(req, res, ["GET", "POST"])) return;

  try {
    if (!getSupabaseAdmin()) {
      console.error(`[admin/emergency-swap] missing env vars: ${getMissingAdminEnvs().join(", ")}`);
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const { error: authError } = await requireAdmin(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    return req.method === "GET" ? handleGet(req, res) : handlePost(req, res);
  } catch (err) {
    console.error("[admin/emergency-swap] UNCAUGHT:", err?.stack || err);
    return res.status(500).json({ error: "Internal error" });
  }
}

// Lee la fila de hoy. Devuelve null si no existe (nadie ha abierto el juego).
async function filaDeHoy(today) {
  const { data, error } = await getSupabaseAdmin()
    .from("daily_cars")
    .select("date, car_id, prev_car_ids")
    .eq("date", today)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function handleGet(req, res) {
  const today = todayInMadrid();
  const fila = await filaDeHoy(today);

  if (!fila) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ today, car: null, jugadores: null });
  }

  const { data: carRow } = await getSupabaseAdmin()
    .from("cars")
    .select("id, make, model, year, pais, image_url")
    .eq("id", fila.car_id)
    .maybeSingle();

  // Recuento: a cuánta gente le va a afectar esto. Los logueados salen exactos
  // de user_guesses; los anónimos, aproximados de guess_audit (una fila por
  // sesión del día). Si cualquiera de las dos falla se devuelve null en vez de
  // un número a medias: el modal prefiere decir «no se pudo contar».
  let logueados = null;
  let anonimos = null;

  const { count: cLog, error: eLog } = await getSupabaseAdmin()
    .from("user_guesses")
    .select("user_id", { count: "exact", head: true })
    .eq("date", today)
    .eq("car_id", fila.car_id);
  if (!eLog) logueados = cLog ?? 0;
  else console.error("[admin/emergency-swap] contar logueados:", eLog);

  const { count: cAnon, error: eAnon } = await getSupabaseAdmin()
    .from("guess_audit")
    .select("user_id", { count: "exact", head: true })
    .eq("game_date", today)
    .eq("mode", "session_start")
    .eq("is_anon", true);
  if (!eAnon) anonimos = cAnon ?? 0;
  else console.error("[admin/emergency-swap] contar anonimos:", eAnon);

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    today,
    car: shapeCar(carRow),
    prevCarIds: fila.prev_car_ids || [],
    jugadores: { logueados, anonimos },
  });
}

async function handlePost(req, res) {
  const body = parseBody(req) || {};
  const carId = typeof body.car_id === "string" ? body.car_id.trim() : "";
  const today = todayInMadrid();

  if (!UUID_RE.test(carId)) {
    return res.status(400).json({ error: "Invalid car_id" });
  }

  const fila = await filaDeHoy(today);
  if (!fila) {
    return res.status(409).json({
      error: "Hoy no tiene coche asignado todavía: no hay nada que cambiar.",
    });
  }
  if (fila.car_id === carId) {
    return res.status(409).json({ error: "Ese ya es el coche de hoy." });
  }

  // `zoom_base` entra en el select porque forma parte del hash de la imagen
  // (api/_lib/version-imagen.js): sin él, el `v` del preload no coincidiría con
  // el que emiten get-daily-car y CarImage, y el CDN guardaría dos entradas.
  const { data: car, error: carErr } = await getSupabaseAdmin()
    .from("cars")
    .select("id, make, model, year, pais, image_url, image_ready, zoom_base")
    .eq("id", carId)
    .maybeSingle();
  if (carErr) {
    console.error("[admin/emergency-swap] read car:", carErr);
    return res.status(500).json({ error: "Failed to read car" });
  }
  if (!car) return res.status(404).json({ error: "Car not found" });

  // Un coche sin foto deja la jornada injugable para todo el mundo: no hay
  // imagen que servir. En una emergencia es justo el error que no te puedes
  // permitir cometer con prisa.
  if (car.image_ready === false || !car.image_url) {
    return res.status(409).json({
      error: "Ese coche no tiene foto lista: dejaría la jornada injugable.",
    });
  }

  // ¿Ya salió, o está programado? Un coche con fila en daily_cars no puede
  // repetirse: mismo criterio que el swap del calendario.
  const { data: existente, error: exErr } = await getSupabaseAdmin()
    .from("daily_cars")
    .select("date")
    .eq("car_id", carId)
    .maybeSingle();
  if (exErr) {
    console.error("[admin/emergency-swap] read existing:", exErr);
    return res.status(500).json({ error: "Failed to check existing" });
  }
  // Si está programado en una fecha futura hay que liberarla, pero DESPUÉS del
  // UPDATE (ver abajo): aquí solo se anota cuál.
  let fechaFuturaALiberar = null;
  if (existente) {
    if (existente.date < today) {
      return res.status(409).json({
        error: `Este coche ya fue coche del día (${existente.date}). No se puede reutilizar.`,
      });
    } else if (existente.date > today) {
      // Programado en el futuro: se libera esa fecha, como hace el swap normal.
      fechaFuturaALiberar = existente.date;
    }
    // `existente.date === today` no cae en ninguna de las dos ramas, y es
    // DELIBERADO: ese caso ya lo cortó el 409 de arriba («Ese ya es el coche de
    // hoy»), así que aquí no puede llegar. La condición se escribe explícita
    // —`> today` en vez de un `else` a secas— porque un DELETE sobre la fila de
    // HOY es lo único de este fichero capaz de borrar `prev_car_ids`, y con
    // ellos la lista de coches salientes: descongelaría a TODOS los jugadores a
    // media partida, dejándolos con un tablero a cero contra el coche nuevo. Si
    // algún día se toca el guard de arriba, este `> today` es lo que impide que
    // el descuido llegue hasta el borrado.
  }

  // El UPDATE lleva el coche saliente en el WHERE: si otra pestaña ha cambiado
  // el coche mientras este modal estaba abierto, no se pisa en silencio — se
  // devuelve 409 y el admin vuelve a mirar. Es lo que en el resto del panel
  // sería un upsert ciego.
  const prev = [...(fila.prev_car_ids || []), fila.car_id];
  const { data: actualizada, error: upErr } = await getSupabaseAdmin()
    .from("daily_cars")
    .update({ car_id: carId, prev_car_ids: prev })
    .eq("date", today)
    .eq("car_id", fila.car_id)
    .select("date");
  if (upErr) {
    console.error("[admin/emergency-swap] update:", upErr);
    return res.status(500).json({ error: "Failed to swap" });
  }
  if (!actualizada?.length) {
    return res.status(409).json({
      error: "El coche de hoy ha cambiado mientras tenías esto abierto. Vuelve a mirar.",
    });
  }

  console.warn(
    `[admin/emergency-swap] coche del día ${today} cambiado; revisión ${prev.length}`
  );

  // La fecha futura se libera AQUÍ, después del UPDATE, y no antes: si el
  // UPDATE pierde la carrera contra otra pestaña y devuelve el 409 de arriba,
  // la asignación futura sigue intacta. Liberándola antes se perdía en
  // silencio mientras el admin leía «vuelve a mirar» — no dejaba ningún día
  // injugable (pick_daily_car rellena el hueco al repintar el calendario),
  // pero sí borraba una decisión suya sin decírselo.
  //
  // Invertir el orden es posible porque en daily_cars la única unicidad es la
  // de `date`: pick_daily_car inserta con `on conflict (date) do nothing`, y su
  // fallback de catálogo agotado llega a repetir un coche a propósito, cosa que
  // un UNIQUE(car_id) prohibiría. O sea: que el coche esté un instante en dos
  // filas (hoy y su fecha futura) no lo rechaza la base de datos.
  if (fechaFuturaALiberar) {
    const { error: delErr } = await getSupabaseAdmin()
      .from("daily_cars")
      .delete()
      .eq("date", fechaFuturaALiberar);
    if (delErr) {
      // El cambio YA está hecho: un 500 aquí le diría al admin que no se ha
      // cambiado nada, y sería mentira — el juego ya sirve el coche nuevo. Se
      // registra y se sigue. Lo que queda es ese coche con DOS filas en
      // daily_cars, que rompe el `.eq("car_id", …).maybeSingle()` de los dos
      // swaps para ESE coche; se arregla liberando la fecha futura desde el
      // calendario.
      console.error(
        `[admin/emergency-swap] free future date ${fechaFuturaALiberar} (el cambio SÍ se hizo):`,
        delErr
      );
    }
  }

  // El preload de la home apunta a la foto del coche que acaba de salir: sin
  // esto, cada visitante nuevo se descargaría una imagen que ya no va a ver.
  // Best-effort y en silencio (regla 9): si Edge Config no está configurado o
  // falla, la home carga igual, solo sin la optimización. El cron de warm-daily
  // lo reescribirá de madrugada de todos modos.
  try {
    const v = await versionDeImagen(car.image_url, clampZoomBase(car.zoom_base));
    const ec = await writeEdgeConfig("daily_preload", {
      date: today,
      img: `/api/daily-image?d=${today}&v=${v}`,
    });
    if (ec?.skipped) console.warn("[admin/emergency-swap] edge config:", ec.reason);
  } catch (err) {
    console.error("[admin/emergency-swap] edge config:", err?.message || err);
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ date: today, car: shapeCar(car), revision: prev.length });
}
