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
// Seguridad: requireAdmin (whitelist por email). Toda la mutación
// pasa por service_role; daily_cars está revocado para anon/authenticated
// por el hardening de RLS.

import { getSupabaseAdmin, getMissingAdminEnvs } from "../../api/_lib/supabase.js";
import { requireAdmin } from "../../api/_lib/auth.js";
import { parseBody, methodGuard } from "../../api/_lib/http.js";
import { todayInMadrid } from "../../api/_lib/date.js";

const DAYS_WINDOW = 14; // 2 semanas: cubre la curación de una temporada entera
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
  if (methodGuard(req, res, ["GET", "POST"])) return;

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

async function handleRandomize(req, res) {
  const today = todayInMadrid();
  const db = getSupabaseAdmin();

  // 1. Obtener todos los coches listos (image_ready IS NOT false)
  const { data: cars, error: carsErr } = await db
    .from("cars")
    .select("id, image_ready");
  if (carsErr) {
    console.error("[admin/schedule] randomize read cars:", carsErr);
    return res.status(500).json({ error: "Failed to read cars catalog" });
  }

  const readyCars = (cars || []).filter((c) => c.image_ready !== false);

  // 2. Obtener coches ya usados (en pasado o hoy)
  const { data: usedRows, error: usedErr } = await db
    .from("daily_cars")
    .select("car_id")
    .lte("date", today);
  if (usedErr) {
    console.error("[admin/schedule] randomize read used:", usedErr);
    return res.status(500).json({ error: "Failed to read used cars" });
  }

  const usedCarIds = new Set((usedRows || []).map((r) => r.car_id).filter(Boolean));

  // 3. Filtrar disponibles (listos y no usados)
  const availableCars = readyCars.filter((c) => !usedCarIds.has(c.id));
  if (availableCars.length < 6) {
    return res.status(400).json({
      error: `No hay suficientes coches libres en el catálogo (${availableCars.length} disponibles, se necesitan 6).`,
    });
  }

  // 4. Barajar y elegir 6
  const shuffled = [...availableCars].sort(() => 0.5 - Math.random());

  // 5. Preparar lote de hoy+1 a hoy+6
  const batch = [];
  for (let i = 1; i <= 6; i++) {
    const nextDate = addDays(today, i);
    const selectedCar = shuffled[i - 1];
    batch.push({
      date: nextDate,
      car_id: selectedCar.id,
    });
  }

  // 6. Guardar en daily_cars
  const { error: upsertErr } = await db
    .from("daily_cars")
    .upsert(batch, { onConflict: "date" });

  if (upsertErr) {
    console.error("[admin/schedule] randomize upsert:", upsertErr);
    return res.status(500).json({ error: "Failed to save randomized schedule", detail: upsertErr.message });
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ success: true, count: batch.length });
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
