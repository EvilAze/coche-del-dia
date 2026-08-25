// api/_lib/version-imagen.js
// El `v` de /api/daily-image?d=…&v=…
//
// Nació como cache-buster: si el admin reemplaza la foto, cambia image_url,
// cambia el hash y el CDN sirve la nueva al instante. Sigue haciendo eso.
//
// Pero desde el cambio de emergencia hace algo más importante: es lo ÚNICO que
// le dice a daily-image qué revisión del día está mirando quien pide la foto.
// Una etiqueta <img> no manda Authorization ni X-Anon-Session, así que ahí no
// hay usuario que resolver — solo la URL. Como el hash sale del coche, un
// congelado y un jugador nuevo piden URLs distintas y la caché compartida del
// CDN no puede servirle la foto de uno al otro.
//
// Por eso vive aquí y no escrito a mano en cada endpoint: si las dos copias
// divergieran, la del proxy dejaría de reconocer las URLs que emite la otra.

import { sha1Hex } from "./edge/crypto.js";

/**
 * @param {string|null} imageUrl
 * @param {number} zoomBase  Entra en el hash porque cambia el crop servido: si
 *   el admin ajusta la dificultad, la entrada cacheada tiene que invalidarse.
 * @returns {Promise<string>} 8 hex, o "0" si el coche no tiene imagen.
 */
export async function versionDeImagen(imageUrl, zoomBase) {
  if (!imageUrl) return "0";
  return (await sha1Hex(`${imageUrl}:${zoomBase}`)).slice(0, 8);
}
