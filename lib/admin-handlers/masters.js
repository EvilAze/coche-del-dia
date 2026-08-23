// lib/admin-handlers/masters.js
// Genera los MASTER de las fotos: un gemelo en WebP, a la MISMA RESOLUCIÓN
// que el original, que /api/daily-image usa como fuente para recortar.
//
// PARA QUÉ. Cada fallo de caché del CDN hace que daily-image se descargue la
// foto entera de Supabase Storage, y las variantes de un día son 54 (3
// anchuras × 3 formatos × 6 estados de zoom). Con originales JPEG de ~1,3 MB
// eso se comió la cuota de egress del plan gratuito en agosto de 2026. El
// master pesa aproximadamente la mitad y se recorta exactamente igual.
//
// LA RESOLUCIÓN NO SE TOCA, y es la decisión importante: lo que ve el jugador
// en cada intento es `ladoCorto × porcentajeDeRecorte`, y ese porcentaje es
// del 22% en el intento 1. Reducir el master reduce directamente la nitidez de
// la vista más ampliada, que es justo el centro del juego. El ahorro sale del
// contenedor, no de los píxeles.
//
// POR QUÉ WEBP Y NO AVIF. AVIF pesaría bastante menos, pero aquí este fichero
// es la FUENTE que sharp tiene que DECODIFICAR en cada invocación de
// daily-image, y decodificar AVIF es sensiblemente más lento. Cambiar egress
// por latencia en el path crítico de la foto no sale a cuenta; WebP decodifica
// rápido y ya recorta el peso a la mitad.
//
// Es idempotente: por defecto salta los que ya tienen master. `?force=1` los
// regenera.

import sharp from "sharp";
import { getSupabaseAdmin, getMissingAdminEnvs } from "../../api/_lib/supabase.js";
import { requireAdmin } from "../../api/_lib/auth.js";
import { urlDelMaster } from "../../api/_lib/imagen-origen.js";

const BUCKET = "cars_images";
// Calidad alta: este fichero no se sirve al navegador, se DECODIFICA para
// recortar de él. Cualquier artefacto que se meta aquí se amplía ×4,5 en el
// intento 1 y luego se vuelve a comprimir en la salida. Barato de más antes
// que justo.
const CALIDAD = 92;
// Cuántas por llamada. Descargar + recodificar + subir una foto de varios MB
// lleva su tiempo, y el handler tiene 45 s de plazo (ver el dispatcher).
const LOTE = 8;

// De la URL pública del master a la ruta dentro del bucket, que es lo que
// necesita storage.upload().
function rutaEnBucket(masterUrl) {
  const m = new URL(masterUrl).pathname.match(/\/object\/public\/[^/]+\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { error: authError } = await requireAdmin(req);
  if (authError) {
    return res.status(authError.status).json({ error: authError.message });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return res.status(500).json({ error: `Faltan envs: ${getMissingAdminEnvs().join(", ")}` });
  }

  const force = req.query?.force === "1";
  const limite = Math.min(Number(req.query?.limit) || LOTE, 20);

  const { data: coches, error } = await admin
    .from("cars")
    .select("id, image_url")
    .eq("image_ready", true)
    .not("image_url", "is", null);
  if (error) {
    console.error("[admin/masters] read cars:", error);
    return res.status(500).json({ error: "No se pudo leer el catálogo" });
  }

  const resultado = { revisados: 0, generados: 0, saltados: 0, fallidos: 0, ahorroBytes: 0, detalle: [] };

  for (const coche of coches) {
    if (resultado.generados >= limite) break;
    resultado.revisados++;

    const masterUrl = urlDelMaster(coche.image_url);
    const ruta = masterUrl && rutaEnBucket(masterUrl);
    if (!ruta) {
      resultado.fallidos++;
      continue;
    }

    try {
      // ¿Ya está? Un HEAD al público es más barato que listar el bucket.
      if (!force) {
        const yaEsta = await fetch(masterUrl, { method: "HEAD" });
        if (yaEsta.ok) {
          resultado.saltados++;
          continue;
        }
      }

      const orig = await fetch(coche.image_url);
      if (!orig.ok) {
        resultado.fallidos++;
        resultado.detalle.push({ id: coche.id, error: `original HTTP ${orig.status}` });
        continue;
      }
      const bytesOrig = Buffer.from(await orig.arrayBuffer());

      // rotate() aplica la orientación EXIF y la normaliza, para que el
      // master ya venga derecho y daily-image recorte sobre lo mismo.
      const bytesMaster = await sharp(bytesOrig)
        .rotate()
        .webp({ quality: CALIDAD, effort: 4 })
        .toBuffer();

      const { error: upErr } = await admin.storage.from(BUCKET).upload(ruta, bytesMaster, {
        contentType: "image/webp",
        upsert: true,
        cacheControl: "31536000", // el master es inmutable: su nombre sale del original
      });
      if (upErr) throw upErr;

      resultado.generados++;
      resultado.ahorroBytes += bytesOrig.length - bytesMaster.length;
      resultado.detalle.push({
        id: coche.id,
        original: bytesOrig.length,
        master: bytesMaster.length,
        ahorro: `${Math.round((1 - bytesMaster.length / bytesOrig.length) * 100)}%`,
      });
    } catch (err) {
      resultado.fallidos++;
      resultado.detalle.push({ id: coche.id, error: err?.message || String(err) });
    }
  }

  const pendientes = coches.length - resultado.saltados - resultado.generados;
  return res.status(200).json({
    ...resultado,
    totalConImagen: coches.length,
    pendientes: Math.max(0, pendientes),
    ahorroMB: +(resultado.ahorroBytes / 1024 / 1024).toFixed(2),
    siguiente: pendientes > 0 ? "vuelve a llamar para el siguiente lote" : "completado",
  });
}
