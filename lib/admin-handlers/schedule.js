// api/admin/schedule.js
// Vista admin del calendario de coches del día: hoy + 13 días siguientes (2
// semanas, para curar una temporada temática entera), con capacidad de swap.
//
// Métodos:
//   GET  /api/admin/schedule
//     Para i=0..13, llama a pick_daily_car(fecha_i). Como la RPC es
//     idempotente (devuelve la fila existente en daily_cars si la hay),
//     esto NO altera asignaciones ya fijadas — solo materializa las que
//     aún no existían. Luego JOIN con `cars` y devuelve datos completos.
//     Además devuelve `usedCarIds`: IDs de coches que YA salieron (incluido
//     el de hoy). El SwapCarModal lo usa para deshabilitar esas opciones
//     en la lista de selección — la regla de no reutilización ya la valida
//     el POST con 409, pero deshabilitar en UI ahorra clicks ciegos.
//     Resultado: { today, days, usedCarIds }.
//
//   POST /api/admin/schedule
//     Body JSON: { date: "YYYY-MM-DD", car_id: uuid }.
//     Asigna `car_id` al día `date` (hoy o futuro, dentro de la ventana
//     de 14 días). Si ese coche estaba en otra fecha futura, libera la
//     vieja. Si ya salió en el pasado o es el coche de hoy, rechaza con
//     409 — no permitimos reusar un coche ya jugado.
//
//     Body JSON: { randomize: true }
//     Vuelve a sortear los 6 días siguientes (hoy+1..hoy+6): libera esas
//     fechas y deja que pick_daily_car las reasigne. Mismo camino que el
//     DELETE de aquí abajo, así que respeta la temática de la temporada
//     que contiene CADA fecha del lote.
//
//   DELETE /api/admin/schedule
//     Body JSON: { date: "YYYY-MM-DD" }  → libera ese día
//                { all: true }           → libera TODOS los días futuros
//                                          de la ventana
//     "Liberar" = borrar la fila de daily_cars para que pick_daily_car
//     vuelva a elegir. Es la pieza que faltaba para las Temporadas
//     Temáticas: como el GET de aquí materializa los 14 días llamando a
//     pick_daily_car, abrir esta pestaña deja el calendario FIJADO. Si
//     luego creas una temporada con filtro, esos días ya asignados no la
//     respetan (el primer escalón del sorteo es "día ya fijado manda"), y
//     hasta ahora la única salida era un DELETE a mano en Supabase.
//
// Seguridad: requireAdmin (whitelist por email). Toda la mutación
// pasa por service_role; daily_cars está revocado para anon/authenticated
// por el hardening de RLS.

import { getSupabaseAdmin, getMissingAdminEnvs } from "../../api/_lib/supabase.js";
import { requireAdmin } from "../../api/_lib/auth.js";
import { parseBody, methodGuard } from "../../api/_lib/http.js";
import { todayInMadrid } from "../../api/_lib/date.js";
import {
  validateFreeDate,
  draftsAllowedFor,
  MIN_DRAFT_OFFSET_DAYS,
} from "../../api/_lib/schedule-free.js";

const DAYS_WINDOW = 14; // 2 semanas: cubre la curación de una temporada entera
// Cuántos días re-sortea el botón «Aleatorizar». Es la mitad de la ventana a
// propósito: «aleatorizar» re-tira la semana que viene y deja la siguiente como
// está; para vaciar las dos semanas ya está «Liberar días futuros».
const RANDOMIZE_DAYS = 6;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Suma `n` días a una fecha YYYY-MM-DD interpretada como naive (sin TZ).
// El cliente no le importa la TZ exacta — todo el sistema usa la fecha
// "calendario Madrid" como identificador. Usar Date + setUTCDate evita
// que un horario de verano nos coma un día.
function addDays(yyyyMmDd, n) {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Las fechas que toca el lote de «aleatorizar», ya pasadas por el guard de
// liberación. Empieza en MAÑANA, nunca en hoy.
//
// Va aquí, exportada y sin I/O, para poder probar justo eso: aleatorizar es
// liberar + volver a sortear, así que le aplican los dos daños irreversibles
// que documenta api/_lib/schedule-free.js — hoy ya se está jugando y el pasado
// es el histórico del que cuelgan El Archivo, los logros y las estadísticas.
// El `i = 1` de abajo lo garantiza, pero el guard es quien lo sostiene si algún
// día alguien toca el bucle.
export function randomizeBatchDates({ today, maxDate, days = RANDOMIZE_DAYS }) {
  const dates = [];
  for (let i = 1; i <= days; i++) {
    const check = validateFreeDate({ date: addDays(today, i), today, maxDate });
    // Un día fuera de la ventana visible se descarta sin tumbar el lote: los
    // demás sí se pueden re-sortear.
    if (check.ok) dates.push(check.date);
  }
  return dates;
}

function shapeCar(row) {
  if (!row) return null;
  return {
    id: row.id,
    marca: row.make,
    modelo: row.model,
    anio: row.year,
    pais: row.pais,
    description: row.description ?? null,
    description_en: row.description_en ?? null,
    image_url: row.image_url ?? null,
  };
}

export default async function handler(req, res) {
  if (methodGuard(req, res, ["GET", "POST", "DELETE"])) return;

  try {
    if (!getSupabaseAdmin()) {
      console.error(`[admin/schedule] missing env vars: ${getMissingAdminEnvs().join(", ")}`);
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const { error: authError } = await requireAdmin(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    if (req.method === "GET") {
      return handleGet(req, res);
    }
    if (req.method === "DELETE") {
      return handleFree(req, res);
    }
    return handlePost(req, res);
  } catch (err) {
    console.error("[admin/schedule] UNCAUGHT:", err && err.stack ? err.stack : err);
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}

async function handleGet(req, res) {
  const today = todayInMadrid();
  const dates = Array.from({ length: DAYS_WINDOW }, (_, i) => addDays(today, i));

  // Materializa cada fecha: la RPC es idempotente, así que llamar a
  // pick_daily_car para hoy+5 simplemente fija ya el coche de ese día.
  // Si alguna RPC falla puntualmente, devolvemos null para esa fecha en
  // vez de romper toda la respuesta — el admin verá un slot vacío y
  // podrá hacer swap manual.
  const carIdByDate = {};
  await Promise.all(
    dates.map(async (date) => {
      const { data, error } = await getSupabaseAdmin().rpc("pick_daily_car", {
        p_date: date,
      });
      if (error) {
        console.error(`[admin/schedule] pick_daily_car(${date}):`, error);
        carIdByDate[date] = null;
        return;
      }
      carIdByDate[date] = data || null;
    })
  );

  const uniqueCarIds = [...new Set(Object.values(carIdByDate).filter(Boolean))];

  let carsById = {};
  if (uniqueCarIds.length > 0) {
    const { data: rows, error: rowsErr } = await getSupabaseAdmin()
      .from("cars")
      .select("id, make, model, year, pais, description, description_en, image_url")
      .in("id", uniqueCarIds);
    if (rowsErr) {
      console.error("[admin/schedule] read cars:", rowsErr);
      return res.status(500).json({ error: "Failed to read cars" });
    }
    carsById = Object.fromEntries((rows || []).map((r) => [r.id, r]));
  }

  const days = dates.map((date) => ({
    date,
    car: shapeCar(carsById[carIdByDate[date]]) || null,
  }));

  // IDs de coches "consumidos": ya jugados en pasado o hoy. Futuros se
  // pueden reasignar libremente (el POST gestiona el swap), así que NO
  // entran. Si falla la lectura no rompemos la respuesta — el frontend
  // simplemente no podrá deshabilitar opciones en el SwapCarModal y el
  // POST devolverá 409 al intentarlo (red-pill UX, pero no se rompe nada).
  let usedCarIds = [];
  const { data: usedRows, error: usedErr } = await getSupabaseAdmin()
    .from("daily_cars")
    .select("car_id")
    .lte("date", today);
  if (usedErr) {
    console.error("[admin/schedule] read used car_ids:", usedErr);
  } else {
    usedCarIds = (usedRows || []).map((r) => r.car_id).filter(Boolean);
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ today, days, usedCarIds });
}

// Vuelve a sortear las fechas dadas llamando a pick_daily_car una por una.
// Devuelve cuántas quedaron asignadas.
//
// Es el único sitio del handler que sortea, y es a propósito: la temática de la
// temporada vive DENTRO de la RPC (busca el `theme_filter` de la temporada que
// contiene esa fecha y filtra con car_matches_theme), así que cualquier camino
// que elija coche sin pasar por aquí se salta el tema en silencio.
//
// SECUENCIAL a propósito, no Promise.all: pick_daily_car inserta su elección en
// daily_cars antes de volver, así que cada asignación cambia el «este coche no
// ha salido nunca» de la siguiente. En paralelo, varios días del lote podrían
// llevarse el mismo coche del tema.
//
// Un fallo puntual no aborta el resto: ese día lo rellenará el GET al repintar
// el calendario, y abortar dejaría media tanda liberada y sin sortear.
async function reassignDates(dates, { today, includeDrafts = false }) {
  let assigned = 0;
  for (const date of dates) {
    // Los borradores son opt-in Y además exigen margen para subir la foto: un
    // coche sin imagen que llega a su día deja la jornada injugable.
    const allowDrafts = includeDrafts === true && draftsAllowedFor({ date, today });
    const { error: rpcErr } = await getSupabaseAdmin().rpc("pick_daily_car", {
      p_date: date,
      p_allow_drafts: allowDrafts,
    });
    if (rpcErr) {
      console.error(`[admin/schedule] reassign(${date}):`, rpcErr);
      continue;
    }
    assigned += 1;
  }
  return assigned;
}

// DELETE — "liberar" días: borra su fila de daily_cars para que pick_daily_car
// vuelva a sortear la próxima vez que se consulte ese día (el GET de este mismo
// handler lo hará al repintar el calendario, ya respetando la temática de la
// temporada activa).
//
// LÍMITE DURO: solo se liberan días ESTRICTAMENTE FUTUROS. No es prudencia
// excesiva, son dos daños distintos e irreversibles:
//
//   · HOY  → la gente ya está jugando. Liberarlo haría que pick_daily_car
//            eligiera otro coche, y las partidas en curso (y las filas ya
//            escritas en user_guesses / daily_stats contra el car_id viejo)
//            quedarían apuntando a un coche que ya no es el del día.
//   · PASADO → daily_cars ES el histórico: de ahí sale qué coche tocó cada día,
//            y con eso El Archivo, los logros y las estadísticas. Borrar una
//            fila pasada no "reordena" nada, destruye el registro.
//
// El guard vive aquí, en el servidor, no en la UI: el botón deshabilitado es
// cortesía, esto es la cerradura.
async function handleFree(req, res) {
  const body = parseBody(req) || {};
  const today = todayInMadrid();
  // Primer día liberable = mañana. Comparar strings YYYY-MM-DD es comparación
  // cronológica correcta (mismo criterio que usa handlePost).
  const firstFreeable = addDays(today, 1);
  const maxDate = addDays(today, DAYS_WINDOW - 1);

  let query = getSupabaseAdmin().from("daily_cars").delete();

  if (body.all === true) {
    // Acotado a la ventana visible: el admin solo puede vaciar lo que ve. Una
    // asignación más allá de hoy+13 no se pinta en el panel, así que borrarla
    // sería un efecto invisible.
    query = query.gte("date", firstFreeable).lte("date", maxDate);
  } else {
    // El guard vive en api/_lib/schedule-free.js, con tests: protege datos
    // irreversibles y no queríamos que su única garantía fuera una lectura
    // atenta de este if/else.
    const check = validateFreeDate({ date: body.date, today, maxDate });
    if (!check.ok) {
      return res.status(check.status).json({ error: check.error });
    }
    query = query.eq("date", check.date);
  }

  // .select() devuelve las filas borradas → sabemos cuántos días se liberaron
  // de verdad, en vez de reportar un éxito genérico.
  const { data, error } = await query.select("date");
  if (error) {
    console.error("[admin/schedule] free:", error);
    return res.status(500).json({ error: "Failed to free dates" });
  }

  const dates = (data || []).map((r) => r.date).filter(Boolean).sort();

  // Modo "voy montando el tema": re-sorteamos AQUÍ mismo permitiendo coches sin
  // foto. Tiene que ser aquí y no en el GET porque el GET llama a la RPC con un
  // solo argumento (p_allow_drafts cae a su default FALSE), que es justo la
  // garantía de que el juego nunca saque un borrador por su cuenta.
  let assigned = 0;
  if (body.include_drafts === true) {
    assigned = await reassignDates(dates, { today, includeDrafts: true });
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    freed: dates.length,
    dates,
    assigned,
    // Para que el panel pueda explicar por qué mañana no recibió un borrador.
    minDraftOffsetDays: MIN_DRAFT_OFFSET_DAYS,
  });
}

// POST { randomize: true } — «vuelve a sortear los próximos 6 días».
//
// UN SOLO CAMINO DE SORTEO: libera las fechas del lote y deja que
// pick_daily_car las vuelva a elegir, exactamente igual que el botón «Liberar
// días futuros».
//
// No es refactor por gusto, es la corrección de un bug silencioso. La versión
// anterior leía `cars` entero, barajaba en JS y hacía upsert directo, sin pasar
// NUNCA por la RPC — y la temática de la temporada vive dentro de la RPC. Con
// una temporada temática activa, pulsar «aleatorizar» la desactivaba para los
// seis días siguientes, y el síntoma («hoy salió un coche que no pinta nada»)
// aparecía días después y lejos de la causa.
//
// Y no valía con filtrar los candidatos por el tema aquí, antes de barajar: el
// predicado es car_matches_theme() en SQL, y una segunda copia en JS es una
// copia que diverge. season_pool_stats() existe justo para no tener dos: el
// preview de pool del panel cuenta con el MISMO predicado del que tira el
// sorteo, y si mintiera se programarían temporadas imposibles.
//
// Lo que NO cambia: sigue tocando solo hoy+1..hoy+6 (nunca hoy ni el pasado),
// sigue reemplazando lo que hubiera programado ahí, y sigue sin poder sacar
// borradores — `cars.image_ready` es NOT NULL DEFAULT TRUE, así que el viejo
// `image_ready !== false` y el `image_ready = true` de la RPC son exactamente
// el mismo conjunto. Los coches sin foto solo entran por la casilla del DELETE.
//
// De paso se cierra un duplicado latente: el barajado descartaba los coches
// usados hasta HOY, pero no los ya programados en hoy+7..hoy+13, así que podía
// colocar el mismo coche dos veces en el calendario — y un coche en dos fechas
// revienta el `.eq("car_id", …).maybeSingle()` del swap. pick_daily_car excluye
// cualquier coche con fila en daily_cars, sea de la fecha que sea.
async function handleRandomize(req, res) {
  const today = todayInMadrid();
  const maxDate = addDays(today, DAYS_WINDOW - 1);
  const dates = randomizeBatchDates({ today, maxDate });

  if (dates.length === 0) {
    // Inalcanzable mientras RANDOMIZE_DAYS < DAYS_WINDOW. Está por si alguien
    // toca esas constantes: mejor un 400 explícito que un `.in("date", [])`.
    return res.status(400).json({ error: "No hay días futuros que aleatorizar." });
  }

  // 1) Liberar. Sin esto no habría sorteo: el primer escalón de pick_daily_car
  //    es «día ya fijado manda», así que devolvería el coche que ya estaba.
  const { error: delErr } = await getSupabaseAdmin()
    .from("daily_cars")
    .delete()
    .in("date", dates);
  if (delErr) {
    console.error("[admin/schedule] randomize free:", delErr);
    return res.status(500).json({ error: "Failed to free dates" });
  }

  // 2) Re-sortear. Sin borradores: este botón es «dame una semana jugable», y
  //    la casilla de coches sin foto pertenece al flujo de liberar.
  const assigned = await reassignDates(dates, { today, includeDrafts: false });

  // Si NINGUNA fecha se pudo reasignar, los días se han quedado liberados. El
  // GET los rellenará al repintar, pero el admin tiene que ver el error en vez
  // de un calendario que "se ha quedado raro" sin explicación.
  if (assigned === 0) {
    return res.status(500).json({ error: "Failed to save randomized schedule" });
  }

  res.setHeader("Cache-Control", "no-store");
  // `count` es el campo que ya devolvía la versión anterior; se mantiene para
  // no romper a quien lo lea, pero ahora cuenta días REALMENTE asignados en vez
  // de los 6 del lote a ciegas. `assigned` es su nombre en el DELETE.
  return res.status(200).json({ success: true, count: assigned, dates, assigned });
}

async function handlePost(req, res) {
  const body = parseBody(req);

  if (body.randomize === true) {
    return handleRandomize(req, res);
  }

  const targetDate = typeof body.date === "string" ? body.date.trim() : "";
  const carId = typeof body.car_id === "string" ? body.car_id.trim() : "";

  if (!DATE_RE.test(targetDate)) {
    return res.status(400).json({ error: "Invalid date (expected YYYY-MM-DD)" });
  }
  if (!UUID_RE.test(carId)) {
    return res.status(400).json({ error: "Invalid car_id" });
  }

  // Solo permitimos tocar fechas en la ventana [hoy, hoy+6]. Bloquear
  // el pasado es obvio (ya se jugó). Bloquear más allá de la ventana
  // visible evita asignaciones "fantasma" que el admin no recordaría.
  const today = todayInMadrid();
  const maxDate = addDays(today, DAYS_WINDOW - 1);
  if (targetDate < today || targetDate > maxDate) {
    return res.status(400).json({
      error: `Solo se pueden modificar fechas entre ${today} y ${maxDate}`,
    });
  }

  // ¿El coche existe?
  const { data: car, error: carErr } = await getSupabaseAdmin()
    .from("cars")
    .select("id, make, model, year, pais, description, description_en, image_url")
    .eq("id", carId)
    .maybeSingle();
  if (carErr) {
    console.error("[admin/schedule] read car:", carErr);
    return res.status(500).json({ error: "Failed to read car" });
  }
  if (!car) {
    return res.status(404).json({ error: "Car not found" });
  }

  // ¿El coche está ya programado en otra fecha?
  const { data: existing, error: existingErr } = await getSupabaseAdmin()
    .from("daily_cars")
    .select("date")
    .eq("car_id", carId)
    .maybeSingle();
  if (existingErr) {
    console.error("[admin/schedule] read daily_cars existing:", existingErr);
    return res.status(500).json({ error: "Failed to check existing" });
  }

  if (existing) {
    if (existing.date === targetDate) {
      // Ya estaba en la fecha objetivo. Es un no-op idempotente.
      return res.status(200).json({ date: targetDate, car: shapeCar(car) });
    }
    if (existing.date < today) {
      return res.status(409).json({
        error: `Este coche ya fue coche del día (${existing.date}). No se puede reutilizar.`,
      });
    }
    if (existing.date === today) {
      return res.status(409).json({
        error: "Este coche es el de hoy. No se puede mover.",
      });
    }
    // existing.date > today → futura: liberamos para que el upsert al
    // targetDate no choque con un eventual UNIQUE(car_id).
    const { error: delErr } = await getSupabaseAdmin()
      .from("daily_cars")
      .delete()
      .eq("date", existing.date);
    if (delErr) {
      console.error("[admin/schedule] free old date:", delErr);
      return res.status(500).json({ error: "Failed to free old date" });
    }
  }

  // Sustituye lo que hubiera en targetDate por este coche. onConflict=date
  // porque date es la PK natural de daily_cars (un coche por día).
  const { error: upErr } = await getSupabaseAdmin()
    .from("daily_cars")
    .upsert({ date: targetDate, car_id: carId }, { onConflict: "date" });
  if (upErr) {
    console.error("[admin/schedule] upsert:", upErr);
    return res.status(500).json({ error: "Failed to assign", detail: upErr.message });
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ date: targetDate, car: shapeCar(car) });
}
