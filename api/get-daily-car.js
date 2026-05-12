// api/get-daily-car.js
// Devuelve el coche del día. Rotación determinista: dayOfYear % count.
// Lee la tabla `cars` de Supabase ordenada por id ascendente.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export default async function handler(req, res) {
  const now = new Date();
  const spainTime = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/Madrid" })
  );
  const start = new Date(spainTime.getFullYear(), 0, 0);
  const diff = spainTime - start;
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);

  // Contar coches para calcular el offset rotatorio.
  const { count, error: countErr } = await supabase
    .from("cars")
    .select("id", { count: "exact", head: true });

  if (countErr || !count) {
    console.error("[get-daily-car] count error:", countErr);
    return res.status(500).json({ message: "No cars available" });
  }

  const offset = dayOfYear % count;

  const { data, error } = await supabase
    .from("cars")
    .select("id, image_url")
    .order("id", { ascending: true })
    .range(offset, offset);

  if (error || !data || data.length === 0) {
    console.error("[get-daily-car] fetch error:", error);
    return res.status(500).json({ message: "Failed to fetch daily car" });
  }

  const row = data[0];

  res.status(200).json({
    id: row.id,
    img: row.image_url,
  });
}
