// api/get-daily-car.js
// Devuelve el coche del día. La elección queda fijada en la tabla
// `daily_cars` la primera vez que se consulta cada día, así que añadir
// coches nuevos al catálogo a mitad del día NO cambia el resultado.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
// service_role bypassea RLS. NO usar en el navegador, solo en este proceso
// serverless. Necesario porque revocamos SELECT(image_url) a anon.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Cliente anon: para RPC pick_daily_car (granted a anon).
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Cliente service_role: para leer columnas restringidas (image_url).
const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

function todayInMadrid() {
  // Formatea la fecha actual en Europe/Madrid como YYYY-MM-DD.
  // Usar Intl en vez de Date.toLocaleString para evitar parsing ambiguo.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts; // "YYYY-MM-DD"
}

export default async function handler(req, res) {
  const today = todayInMadrid();

  // 1) Pedir el coche del día. La RPC inserta en daily_cars la primera
  //    vez y devuelve el id fijado en todas las llamadas posteriores.
  //    Llamamos con service_role: pick_daily_car está revocado de
  //    anon/authenticated para que el cliente no pueda obtener el id
  //    de hoy y cruzarlo con la tabla cars (catálogo público).
  if (!supabaseAdmin) {
    console.error("[get-daily-car] missing SUPABASE_SERVICE_ROLE_KEY");
    return res.status(500).json({ message: "Server misconfigured" });
  }
  const { data: carId, error: rpcErr } = await supabaseAdmin.rpc(
    "pick_daily_car",
    { p_date: today }
  );

  if (rpcErr || !carId) {
    console.error("[get-daily-car] pick_daily_car error:", rpcErr);
    return res.status(500).json({ message: "Failed to pick daily car" });
  }

  // 2) Cargar la imagen del coche elegido (columna privilegiada).
  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("cars")
    .select("id, image_url")
    .eq("id", carId)
    .single();

  if (fetchErr || !row) {
    console.error("[get-daily-car] fetch car error:", fetchErr);
    return res.status(500).json({ message: "Failed to load daily car" });
  }

  res.status(200).json({
    id: row.id,
    img: row.image_url,
  });
}
