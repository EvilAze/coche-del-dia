// api/list-cars.js
// Devuelve el catálogo completo en una sola request, con los formatos
// derivados que consume el frontend (marcas, países, mapa marca→país).
//
// Se cachea en el CDN de Vercel 5 min para no martillear la BD.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Only GET allowed" });
  }

  // NOTA: image_url se omite a propósito. Si lo expusiéramos aquí, cualquiera
  // podría cruzarlo con la URL que devuelve /api/get-daily-car y deducir
  // marca/modelo/año del coche del día. Para mostrar imágenes en herramientas
  // internas (Preview), hay endpoints separados con auth.
  const { data, error } = await supabase
    .from("cars")
    .select("id, make, model, year, pais")
    .order("id", { ascending: true });

  if (error) {
    console.error("[list-cars]", error);
    return res.status(500).json({ message: "Error reading cars" });
  }

  // Mapeamos a las claves en español que ya usa el frontend.
  const cars = data.map((row) => ({
    id: row.id,
    marca: row.make,
    modelo: row.model,
    anio: row.year,
    pais: row.pais,
  }));

  const marcas = [...new Set(cars.map((c) => c.marca))].sort((a, b) =>
    a.localeCompare(b, "es")
  );
  const paises = [...new Set(cars.map((c) => c.pais).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "es")
  );
  const marcaPais = {};
  for (const c of cars) {
    if (c.pais && !marcaPais[c.marca]) marcaPais[c.marca] = c.pais;
  }

  // 5 min en CDN, 1 min de stale-while-revalidate para no servir páginas frías.
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=60"
  );
  res.status(200).json({ cars, marcas, paises, marcaPais });
}
