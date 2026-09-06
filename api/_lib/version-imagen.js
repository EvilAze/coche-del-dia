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

/**
 * El `v` de /api/car-image?t=…&v=… — la portada del Archivo.
 *
 * Mismo oficio que `versionDeImagen` pero sin `zoomBase`: la portada del
 * garaje no se recorta, así que lo único que puede cambiar sus bytes es que
 * el admin sustituya la foto.
 *
 * PARA QUÉ SIRVE, que no es solo invalidar. Sin `v`, la URL de una portada es
 * la misma para siempre (el token es determinista por carId+mode), así que la
 * caché del CDN no puede ser eterna: si lo fuera, una foto cambiada por el
 * admin no se vería NUNCA. Con `v` la URL cambia sola cuando cambia la foto, y
 * eso es lo que permite marcar la respuesta `immutable` y dejar de pagarle a
 * Supabase una descarga por PoP y semana.
 *
 * Es seguro precisamente porque el admin nunca pisa una ruta: EditCarPanel
 * sube a `${Date.now()}-${nombre}` con `upsert: false`, así que una foto nueva
 * es SIEMPRE una image_url nueva. Si algún día eso cambiara a sobrescribir la
 * misma ruta, este hash dejaría de moverse y la portada vieja se quedaría
 * clavada un año.
 *
 * SOLO SE EMITE PARA CROMOS DESBLOQUEADOS. En uno bloqueado sería un
 * identificador estable derivado del nombre real del fichero (que lleva
 * marca-modelo-año), y eso es justo la correlación que garage.js se molesta en
 * romper con `pseudoIdFor`. Además ahí no hay nada que ahorrar: el bloqueado se
 * sirve como un JPEG borroso de 3-5 KB.
 *
 * @param {string|null} imageUrl
 * @returns {Promise<string>} 8 hex, o "0" si el coche no tiene imagen.
 */
export async function versionDePortada(imageUrl) {
  if (!imageUrl) return "0";
  return (await sha1Hex(`portada:${imageUrl}`)).slice(0, 8);
}
