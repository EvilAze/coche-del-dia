// api/list-cars.js
// Devuelve el catálogo completo en una sola request, con los formatos
// derivados que consume el frontend (marcas, países, mapa marca→país).
//
// TRES CERROJOS, de dentro afuera (oct-2026):
//
//   1. La BASE ya no sirve el catálogo a `anon`/`authenticated`
//      (scripts/2026-10-catalogo-privado.sql): se lee con service_role. Es el
//      cerrojo que importa — la anon key viaja en el bundle, así que mientras
//      PostgREST contestara `cars?select=make,model,…` directamente, cerrar
//      este endpoint no cerraba nada.
//   2. Solo contesta a NUESTRA página (web same-origin o la app), y da 403 a
//      quien abre la URL a mano, la enlaza desde otra web o la pide desde un
//      dominio ajeno (api/_lib/origen-propio.js). Lo que no puede ser es
//      privado del todo: el cupón necesita las marcas y los modelos en el
//      navegador, y lo que llega al navegador lo puede leer quien lo maneja.
//      Esto sube el listón para curiosos y scrapers; no para quien imite las
//      cabeceras a mano.
//   3. Solo los campos que pinta el cupón. `image_ready` salió: decía qué
//      coches NO pueden ser el coche del día (pick_daily_car solo sortea entre
//      los que tienen foto) y recortaba los candidatos un tercio. El panel lo
//      pide ahora por /api/admin/pendientes-imagen.
//
// CACHÉ: en el navegador (private) y en la memoria de la instancia, YA NO en el
// CDN. Con `s-maxage` el CDN servía su copia sin despertar a la función, o sea
// sin pasar por el cerrojo 2: el primer jugador la dejaba en el edge y a partir
// de ahí cualquiera la recogía cinco minutos. Una instancia caliente contesta
// desde memoria sin tocar Supabase, así que la base no nota la diferencia.

import { getSupabaseAdmin, getMissingAdminEnvs } from "./_lib/supabase.js";
import { methodGuard, applyCors } from "./_lib/http.js";
import { esPeticionPropia } from "./_lib/origen-propio.js";
import { conTimeoutOFallback, PLAZOS } from "./_lib/timeout.js";

const TTL_MS = 5 * 60 * 1000;
// { cuerpo, hasta } de la última lectura buena, por instancia. `?fresh=` (el
// panel tras guardar un coche) se la salta: quien acaba de crear un coche
// tiene que verlo ya, no dentro de cinco minutos.
let enMemoria = null;

export default async function handler(req, res) {
  if (applyCors(req, res)) return; // preflight OPTIONS / headers CORS
  if (methodGuard(req, res, "GET")) return;

  if (!esPeticionPropia(req)) {
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(403).json({ message: "Forbidden" });
  }

  const fresco = req.query?.fresh != null;
  if (!fresco && enMemoria && enMemoria.hasta > Date.now()) {
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.status(200).json(enMemoria.cuerpo);
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    console.error(`[list-cars] missing env vars: ${getMissingAdminEnvs().join(", ")}`);
    return res.status(500).json({ message: "Server misconfigured" });
  }

  // NOTA: image_url se omite a propósito. Si lo expusiéramos aquí, cualquiera
  // podría cruzarlo con la URL que devuelve /api/get-daily-car y deducir
  // marca/modelo/año del coche del día. Con service_role la base ya no lo
  // impide por GRANT, así que la lista de columnas ES la política: no añadas
  // nada que el cupón no pinte.
  const { data, error } = await conTimeoutOFallback(
    supabaseAdmin
      .from("cars")
      .select("id, make, model, year, pais")
      .order("id", { ascending: true }),
    PLAZOS.SUPABASE,
    { data: null, error: { message: "read cars sin respuesta a tiempo" } },
    { etiqueta: "list-cars" }
  );

  if (error || !Array.isArray(data)) {
    console.error("[list-cars]", error);
    // Una copia caducada es mejor que un cupón sin marcas: el catálogo cambia
    // como mucho cuando el admin da de alta un coche.
    if (enMemoria) {
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(200).json(enMemoria.cuerpo);
    }
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

  const cuerpo = { cars, marcas, paises, marcaPais };
  enMemoria = { cuerpo, hasta: Date.now() + TTL_MS };

  res.setHeader("Cache-Control", fresco ? "private, no-store" : "private, max-age=300");
  res.status(200).json(cuerpo);
}
