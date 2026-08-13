// api/_lib/video-id.js
// El ID de YouTube de un coche (temporadas presentadas), normalizado.
//
// POR QUÉ EXISTE. La columna `cars.video_id` guarda solo el ID de 11
// caracteres y la BD lo defiende con un CHECK — pero quien rellena el campo
// está mirando YouTube, y lo que tiene en el portapapeles es una URL. Peor: no
// una, sino cinco formas distintas de la misma URL según de dónde la copie
// (barra del navegador, botón «Compartir», Shorts, un embed, el enlace con
// marca de tiempo). Sin esto, poblar una temporada de treinta coches es
// treinta oportunidades de pegar algo que la BD rechaza con un error de
// constraint que no explica nada.
//
// Así que aceptamos lo que el admin tiene a mano y guardamos siempre lo mismo.
// La validación de verdad sigue estando en el CHECK de Postgres: esto es
// comodidad, no seguridad.
//
// NO TOCA RED. No comprueba que el vídeo exista, ni que permita embeberse: eso
// solo lo sabe YouTube, y una petición por guardado a cambio de una respuesta
// que puede cambiar mañana no compensa. Si el vídeo no existe o el canal ha
// desactivado el embebido, el reproductor lo dice dentro de su propio marco y
// el resto del panel de resultado sigue funcionando.

// 11 caracteres del alfabeto base64url. Es el formato de los IDs de YouTube
// desde siempre y el mismo que exige el CHECK de la columna.
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Las formas de URL que se pegan en la práctica. El ID va siempre al final del
// grupo, y el resto de la cadena (parámetros, marcas de tiempo, listas) se
// descarta a propósito: el reproductor lo monta el cliente con sus propios
// parámetros.
const PATRONES = [
  /[?&]v=([A-Za-z0-9_-]{11})/,           // youtube.com/watch?v=ID
  /youtu\.be\/([A-Za-z0-9_-]{11})/,      // youtu.be/ID
  /\/shorts\/([A-Za-z0-9_-]{11})/,       // youtube.com/shorts/ID
  /\/embed\/([A-Za-z0-9_-]{11})/,        // youtube.com/embed/ID
  /\/live\/([A-Za-z0-9_-]{11})/,         // youtube.com/live/ID
];

/**
 * Normaliza lo que venga a un ID de YouTube.
 *
 * @param {unknown} entrada
 * @returns {{ value: string|null, error: string|null }}
 *   - `value: null` sin error → el campo se BORRA (cadena vacía = «quítaselo»).
 *   - `error` con texto → no se toca nada y el handler responde 400.
 */
export function normalizeVideoId(entrada) {
  if (entrada === null || entrada === undefined) {
    return { value: null, error: null };
  }
  if (typeof entrada !== "string") {
    return { value: null, error: "video_id debe ser texto" };
  }

  const limpio = entrada.trim();
  if (limpio === "") return { value: null, error: null };

  if (ID_RE.test(limpio)) return { value: limpio, error: null };

  for (const patron of PATRONES) {
    const m = limpio.match(patron);
    if (m) return { value: m[1], error: null };
  }

  return {
    value: null,
    error:
      "video_id no reconocido: pega el enlace del vídeo de YouTube o su ID de 11 caracteres",
  };
}
