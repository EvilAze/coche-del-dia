// api/get-daily-car.js
// Devuelve el estado del juego de HOY sin filtrar ningún dato cruzable con
// el catálogo público:
//   - NO se devuelve `id` del coche del día (antes permitía cruzarlo con
//     /api/list-cars y deducir marca/modelo/año).
//   - NO se devuelve la URL real del CDN (antes contenía el nombre del coche
//     en el filename). En su lugar apuntamos al proxy /api/daily-image, que
//     sirve los bytes desde nuestro servidor.
//
// Para usuarios logueados también devolvemos el estado guardado (intentos,
// status, score si ganó/perdió) leyéndolo server-side de user_guesses, para
// que el frontend no tenga que conocer el car_id para hacer esa consulta.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

function todayInMadrid() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function extractAccessToken(req) {
  const header = req.headers?.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

async function authClientAndUser(accessToken) {
  if (!accessToken) return { client: null, user: null };
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return { client: null, user: null };
  return { client, user: data.user };
}

export default async function handler(req, res) {
  if (!supabaseAdmin) {
    console.error("[get-daily-car] missing SUPABASE_SERVICE_ROLE_KEY");
    return res.status(500).json({ message: "Server misconfigured" });
  }

  const today = todayInMadrid();

  // Resolvemos el coche del día solo para verificar que existe y para que la
  // RPC haga su trabajo de fijarlo en daily_cars. NO devolvemos el id.
  const { data: todayCarId, error: rpcErr } = await supabaseAdmin.rpc(
    "pick_daily_car",
    { p_date: today }
  );
  if (rpcErr || !todayCarId) {
    console.error("[get-daily-car] pick_daily_car:", rpcErr);
    return res.status(500).json({ message: "Failed to pick daily car" });
  }

  const accessToken = extractAccessToken(req);
  const { client: authClient, user } = await authClientAndUser(accessToken);

  // Estado base que vale para anónimos.
  // Cache-buster para que el navegador no reutilice la imagen entre días si
  // el CDN intermedio se confunde.
  const base = {
    date: today,
    img: `/api/daily-image?d=${today}`,
    guesses: [],
    status: "playing",
    reveal: null,
  };

  if (!user) {
    // No queremos que un CDN cachee el estado del usuario, pero la respuesta
    // anónima es estable durante el día. Aun así, dejamos no-store para no
    // arriesgar contaminación cruzada con cabeceras Auth.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(base);
  }

  // Usuario logueado: leemos su fila de user_guesses (RLS exige auth.uid()).
  const { data: row, error: rowErr } = await authClient
    .from("user_guesses")
    .select("guesses, status, car_data")
    .eq("user_id", user.id)
    .eq("car_id", todayCarId)
    .eq("date", today)
    .maybeSingle();

  if (rowErr) {
    console.error("[get-daily-car] read user_guesses:", rowErr);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(base);
  }

  const status = row?.status || "playing";
  const guesses = Array.isArray(row?.guesses) ? row.guesses : [];

  // Revelamos marca/modelo/año si el usuario ganó o si perdió. user_guesses
  // está protegido por RLS (auth.uid()), así que para llegar a este punto el
  // servidor ya verificó que la partida está realmente cerrada.
  let reveal = null;
  if ((status === "won" || status === "lost") && row?.car_data) {
    reveal = {
      marca: row.car_data.marca,
      modelo: row.car_data.modelo,
      anio: row.car_data.anio,
      pais: row.car_data.pais,
    };
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    date: today,
    img: `/api/daily-image?d=${today}`,
    guesses,
    status,
    reveal,
  });
}
