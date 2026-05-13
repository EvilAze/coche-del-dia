// api/daily-image.js
// Proxy de la imagen del coche del día. El cliente solo recibe los bytes;
// la URL real del CDN (que contenía marca-modelo-año en el filename) NUNCA
// se expone al navegador.
//
// Flujo:
//   1) Resolvemos el coche del día con pick_daily_car (service_role: la RPC
//      está revocada de anon/authenticated por hardening previo).
//   2) Leemos image_url de la fila (columna privilegiada).
//   3) Hacemos un fetch server-side al CDN y devolvemos el buffer al cliente
//      con los mismos Content-Type / Content-Length.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
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

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ message: "Only GET allowed" });
  }

  if (!supabaseAdmin) {
    console.error("[daily-image] missing SUPABASE_SERVICE_ROLE_KEY");
    return res.status(500).json({ message: "Server misconfigured" });
  }

  const today = todayInMadrid();

  // 1) Coche del día.
  const { data: carId, error: rpcErr } = await supabaseAdmin.rpc(
    "pick_daily_car",
    { p_date: today }
  );
  if (rpcErr || !carId) {
    console.error("[daily-image] pick_daily_car:", rpcErr);
    return res.status(500).json({ message: "Failed to pick daily car" });
  }

  // 2) URL real del CDN. Nunca sale de este proceso.
  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("cars")
    .select("image_url")
    .eq("id", carId)
    .single();
  if (fetchErr || !row?.image_url) {
    console.error("[daily-image] fetch car:", fetchErr);
    return res.status(500).json({ message: "Failed to load daily car" });
  }

  // 3) Fetch server-side de los bytes. Si el CDN falla, propagamos el status
  //    para que el cliente sepa que no es un error de nuestra app.
  let upstream;
  try {
    upstream = await fetch(row.image_url);
  } catch (err) {
    console.error("[daily-image] upstream fetch:", err);
    return res.status(502).json({ message: "Upstream image unavailable" });
  }

  if (!upstream.ok) {
    console.error("[daily-image] upstream status:", upstream.status);
    return res.status(502).json({ message: "Upstream image error" });
  }

  const contentType = upstream.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await upstream.arrayBuffer());

  // Cache corta (60 s) para que el hot-swap desde /admin/edit-car se
  // refleje rápido si se cambia la imagen del coche del día. Sigue
  // amortizando el grueso del tráfico vía CDN.
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", String(buffer.length));
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=60, stale-while-revalidate=30"
  );
  // Por si acaso algún proxy intermedio mira el Content-Disposition:
  // forzamos inline sin filename, evitando filtrar el original del CDN.
  res.setHeader("Content-Disposition", "inline");

  if (req.method === "HEAD") {
    return res.status(200).end();
  }
  return res.status(200).send(buffer);
}
