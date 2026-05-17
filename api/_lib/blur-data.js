// api/_lib/blur-data.js
// Genera un LQIP (Low Quality Image Placeholder) en base64 a partir de la
// URL pública de la foto de un coche. El resultado es una data URI ~0.5-1 KB
// que el cliente puede pintar instantáneamente como fondo del skeleton
// mientras descarga la foto real, eliminando el flash gris vacío.
//
// Diseño:
//   - 24 px de ancho con ratio preservado (resize 24 x null). Suficiente para
//     intuir silueta y paleta del coche; pequeño suficiente para que pese
//     poco en el JSON inicial.
//   - JPEG quality 30 + mozjpeg → ~400-700 bytes raw → ~600-950 chars en b64.
//   - blur(1) ligero para que el resultado ya parezca "borroso" sin necesidad
//     de blur CSS agresivo en el cliente (el cliente además le aplicará un
//     filter:blur encima, así que NO hace falta saturar aquí).
//   - Devolvemos null si algo falla; el caller decide si fallar la operación
//     o seguir sin LQIP. En la práctica preferimos seguir sin LQIP antes que
//     romper un alta/edición de coche por un fallo de imagen upstream.

import sharp from "sharp";

const LQIP_WIDTH = 24;
const LQIP_QUALITY = 30;

export async function generateBlurData(imageUrl) {
  if (typeof imageUrl !== "string" || !imageUrl.startsWith("http")) {
    return null;
  }

  let upstream;
  try {
    upstream = await fetch(imageUrl);
  } catch (err) {
    console.error("[blur-data] fetch upstream:", err?.message || err);
    return null;
  }
  if (!upstream.ok) {
    console.error("[blur-data] upstream status:", upstream.status);
    return null;
  }

  let buf;
  try {
    buf = Buffer.from(await upstream.arrayBuffer());
  } catch (err) {
    console.error("[blur-data] read buffer:", err?.message || err);
    return null;
  }

  try {
    const out = await sharp(buf)
      .rotate() // respeta EXIF
      .resize(LQIP_WIDTH, null, { fit: "inside", withoutEnlargement: true })
      .blur(1)
      .jpeg({ quality: LQIP_QUALITY, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch (err) {
    console.error("[blur-data] sharp pipeline:", err?.message || err);
    return null;
  }
}
