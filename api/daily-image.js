// api/daily-image.js
// Proxy de la imagen del coche del día. El cliente solo recibe los bytes;
// la URL real del CDN (que contenía marca-modelo-año en el filename) NUNCA
// se expone al navegador.
//
// Flujo:
//   1) Resolvemos el coche del día con pick_daily_car (service_role: la RPC
//      está revocada de anon/authenticated por hardening previo).
//   2) Leemos image_url de la fila (columna privilegiada).
//   3) Hacemos un fetch server-side al CDN.
//   4) Si el cliente pidió `?w` o `?f`, redimensionamos / recodificamos con
//      sharp. Si no, passthrough literal.
//
// Query params:
//   ?d=YYYY-MM-DD   → cache buster diario (no se lee aquí; es solo cache key).
//   ?v=<hash>       → hash corto de image_url (no se lee aquí; es solo cache
//                     key — invalida automáticamente cuando admin cambia la
//                     foto desde /admin/edit-car).
//   ?w=320|640|1280 → ancho objetivo. Allowlist estricta para evitar DoS por
//                     resize a tamaños absurdos.
//   ?f=avif|webp|jpeg → formato de salida. Allowlist estricta.
//
// Cache:
//   Cada combinación (d, v, w, f) tiene su propia entrada en el edge cache
//   de Vercel. El cost de sharp se paga una vez por entrada y región, y
//   luego durante 24 h se sirve desde el CDN sin tocar la función.

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

// Allowlists. Cambiar aquí también requiere actualizar CarImage.jsx (los
// srcset del front), que es donde se decide qué tamaños se piden.
//
// Por qué los widths empiezan en 640 y no en 320: el juego aplica un
// transform:scale(3.5x → 1.8x) sobre la imagen durante la fase "playing".
// Eso significa que el "slot efectivo" en pantalla es 2-3.5× el contenedor.
// Servir 320w para un slot CSS de 320 daba ~91 px de archivo fuente tras
// el zoom 3.5x → upscale ~8x → pixelado evidente. 640 es el suelo decente
// (después del zoom: ~180 px fuente, upscale ~4x, aún algo blando), y 1920
// el techo para móviles de alta densidad con DPR 3 y zoom máximo.
const ALLOWED_WIDTHS = new Set([640, 1280, 1920]);
const FORMAT_MIME = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
};

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

  // 3) Validamos params de procesamiento. Las allowlists son estrictas: si
  //    el cliente pide algo fuera del set, lo ignoramos (no devolvemos 400)
  //    para que un visitante con un srcset cacheado obsoleto no rompa.
  const wRaw = Number(req.query?.w);
  const wantedWidth =
    Number.isFinite(wRaw) && ALLOWED_WIDTHS.has(wRaw) ? wRaw : null;

  const fRaw = String(req.query?.f || "").toLowerCase();
  const wantedFormat = fRaw in FORMAT_MIME ? fRaw : null;

  // 4) Fetch server-side de los bytes. Si el CDN falla, propagamos el status
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

  const originalContentType =
    upstream.headers.get("content-type") || "image/jpeg";
  const originalBuffer = Buffer.from(await upstream.arrayBuffer());

  // 5) Procesamiento. Si el cliente pidió tamaño o formato, pasamos por
  //    sharp. Si no, passthrough (mantenemos backward-compat con cualquier
  //    enlace antiguo que llegue sin params, p.ej. tarjetas OG cacheadas).
  let outBuffer = originalBuffer;
  let outContentType = originalContentType;

  if (wantedWidth !== null || wantedFormat !== null) {
    try {
      let pipeline = sharp(originalBuffer).rotate(); // rotate() respeta EXIF
      if (wantedWidth !== null) {
        pipeline = pipeline.resize(wantedWidth, null, {
          fit: "inside",
          withoutEnlargement: true,
        });
      }
      if (wantedFormat === "avif") {
        // effort 4 es el sweet spot calidad/tiempo. quality 50 da archivos
        // ~10-15 KB para una foto 640w típica con calidad visual indistinta
        // del JPEG q80 a simple vista.
        pipeline = pipeline.avif({ quality: 50, effort: 4 });
      } else if (wantedFormat === "webp") {
        pipeline = pipeline.webp({ quality: 75 });
      } else if (wantedFormat === "jpeg") {
        pipeline = pipeline.jpeg({
          quality: 80,
          mozjpeg: true,
          progressive: true,
        });
      }
      outBuffer = await pipeline.toBuffer();
      if (wantedFormat !== null) outContentType = FORMAT_MIME[wantedFormat];
    } catch (err) {
      // Si sharp falla por cualquier motivo (input corrupto, OOM, formato
      // raro), seguimos sirviendo el original. Mejor entregar una imagen
      // grande que ningún LCP.
      console.error("[daily-image] sharp pipeline:", err?.message || err);
      outBuffer = originalBuffer;
      outContentType = originalContentType;
    }
  }

  // Cache fuerte (24 h) en navegador y CDN: el coche de una fecha dada es
  // determinista (pick_daily_car con la misma p_date siempre devuelve lo
  // mismo) y los query params (d, v, w, f) ya rotan la cache key cada día
  // o cuando el admin cambia la foto. Esta imagen es además el LCP element
  // del juego — cada cache miss penaliza ~300-800 ms (más con AVIF).
  res.setHeader("Content-Type", outContentType);
  res.setHeader("Content-Length", String(outBuffer.length));
  res.setHeader(
    "Cache-Control",
    "public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400, immutable"
  );
  // Por si acaso algún proxy intermedio mira el Content-Disposition:
  // forzamos inline sin filename, evitando filtrar el original del CDN.
  res.setHeader("Content-Disposition", "inline");

  if (req.method === "HEAD") {
    return res.status(200).end();
  }
  return res.status(200).send(outBuffer);
}
