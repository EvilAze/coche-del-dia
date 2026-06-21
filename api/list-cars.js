// api/list-cars.js
// Devuelve el catálogo completo en una sola request, con los formatos
// derivados que consume el frontend (marcas, países, mapa marca→país).
//
// Se cachea en el CDN de Vercel 5 min para no martillear la BD.

import { getSupabasePublic, getMissingPublicEnvs } from "./_lib/supabase.js";
import { methodGuard, applyCors } from "./_lib/http.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) return; // preflight OPTIONS / headers CORS
  if (methodGuard(req, res, "GET")) return;

  const supabasePublic = getSupabasePublic();
  if (!supabasePublic) {
    console.error(`[list-cars] missing env vars: ${getMissingPublicEnvs().join(", ")}`);
    return res.status(500).json({ message: "Server misconfigured" });
  }

  // NOTA: image_url se omite a propósito. Si lo expusiéramos aquí, cualquiera
  // podría cruzarlo con la URL que devuelve /api/get-daily-car y deducir
  // marca/modelo/año del coche del día. Para mostrar imágenes en herramientas
  // internas (Preview), hay endpoints separados con auth.
  //
  // image_ready SÍ se expone: el admin lo usa para ver qué coches están
  // pendientes de imagen. No revela nada sensible — solo dice "este coche
  // existe en catálogo pero todavía no es elegible para coche del día".
  // El daily real va por otro endpoint (get-daily-car) con su propio hardening.
  const { data, error } = await supabasePublic
    .from("cars")
    .select("id, make, model, year, pais, image_ready")
    .order("id", { ascending: true });

  if (error) {
    console.error("[list-cars]", error);
    return res.status(500).json({ message: "Error reading cars" });
  }

  // Mapeamos a las claves en español que ya usa el frontend.
  // image_ready se incluye sólo si la columna existe (defensa por si se
  // consulta antes de aplicar la migración SQL: el ?? true mantiene el
  // comportamiento legacy de "todo coche está listo").
  const cars = data.map((row) => ({
    id: row.id,
    marca: row.make,
    modelo: row.model,
    anio: row.year,
    pais: row.pais,
    image_ready: row.image_ready ?? true,
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
