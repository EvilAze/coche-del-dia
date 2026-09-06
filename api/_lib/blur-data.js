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
import { leerImagenOrigen } from "./imagen-origen.js";

const LQIP_WIDTH = 24;
const LQIP_QUALITY = 30;

export async function generateBlurData(imageUrl) {
  if (typeof imageUrl !== "string" || !imageUrl.startsWith("http")) {
    return null;
  }

  // Los bytes, por el mismo helper que el resto de rutas de imagen: prefiere
  // el máster WebP y cae al original si no existe. Aquí el ahorro es el más
  // pequeño de los tres —esto corre en el alta/edición de un coche, o sea una
  // vez por foto, y encima sobre una foto RECIÉN subida, que casi nunca tendrá
  // máster todavía— pero pasar por la misma puerta que los demás es lo que
  // evita que dentro de un año quede un `fetch` suelto que nadie relacione con
  // la factura. Lo que sí gana de verdad es el plazo de PLAZOS.CDN (regla 21):
  // este fetch no tenía ninguno, y un Storage lento colgaba el guardado del
  // coche entero, no solo el LQIP.
  //
  // El helper ya registra el motivo del fallo, así que aquí solo queda la
  // decisión que este módulo tenía desde el principio: sin bytes, no hay LQIP
  // y se devuelve null; el caller prefiere guardar el coche sin blur_data
  // antes que romper el alta.
  const origen = await leerImagenOrigen(imageUrl);
  if (!origen) return null;
  const buf = origen.buffer;

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
