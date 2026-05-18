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
import crypto from "node:crypto";

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

  // Cache-buster derivado de image_url. Cuando el admin reemplaza la foto
  // desde /admin/edit-car, el nuevo path lleva Date.now() en el nombre, así
  // que image_url cambia y el hash cambia → el navegador y el CDN reciben
  // un URL distinto y refrescan al instante, sin esperar al s-maxage de 24h
  // del endpoint /api/daily-image.
  // Si admin solo edita texto (marca/modelo/año/país/descripción), image_url
  // no se toca, el hash es estable y el CDN mantiene el hit caliente para
  // todos los visitantes.
  // El hash NO filtra el coche: image_url no es público (list-cars lo omite)
  // y un sha1 truncado no permite reverse-engineering.
  // Aprovechamos para leer también blur_data — el LQIP que el cliente pinta
  // como fondo del skeleton mientras descarga la foto real. La data URI pesa
  // ~0.5-1 KB, despreciable comparado con el coste de pintar gris vacío.
  // image_url NO se devuelve al cliente; solo sirve para computar el hash.
  const { data: imgRow, error: imgRowErr } = await supabaseAdmin
    .from("cars")
    .select("image_url, blur_data")
    .eq("id", todayCarId)
    .maybeSingle();
  if (imgRowErr) {
    // Si esto falla por algún motivo, seguimos sin versión (cache "vieja"
    // hasta el TTL natural). Es estrictamente mejor que romper la home.
    console.error("[get-daily-car] read image_url for version:", imgRowErr);
  }
  const imgVersion = imgRow?.image_url
    ? crypto.createHash("sha1").update(imgRow.image_url).digest("hex").slice(0, 8)
    : "0";
  const dailyImgUrl = `/api/daily-image?d=${today}&v=${imgVersion}`;
  const blurData = imgRow?.blur_data || null;

  // Estado base que vale para anónimos.
  const base = {
    date: today,
    img: dailyImgUrl,
    blurData,
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
    .select("guesses, status")
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

  // Revelamos marca/modelo/año si el usuario ganó o si perdió. Leemos los
  // datos LIVE desde `cars` (no desde la copia congelada en user_guesses)
  // para que las correcciones que haga el admin en /admin/edit-car se
  // reflejen al instante en pantalla — hot-swap real.
  let reveal = null;
  if (status === "won" || status === "lost") {
    const { data: liveCar, error: liveErr } = await supabaseAdmin
      .from("cars")
      .select("make, model, year, pais, description, description_en")
      .eq("id", todayCarId)
      .maybeSingle();
    if (liveErr) {
      console.error("[get-daily-car] read cars (live):", liveErr);
    } else if (liveCar) {
      reveal = {
        marca: liveCar.make,
        modelo: liveCar.model,
        anio: liveCar.year,
        pais: liveCar.pais,
        description: liveCar.description ?? null,
        description_en: liveCar.description_en ?? null,
      };
    }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    date: today,
    img: dailyImgUrl,
    blurData,
    guesses,
    status,
    reveal,
  });
}
