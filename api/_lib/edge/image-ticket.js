// api/_lib/edge/image-ticket.js
// El TICKET que abre el recorte de cada intento en /api/daily-image.
//
// EL AGUJERO QUE CIERRA. Durante la partida el cliente pedía SIEMPRE `?z=5`
// —el recorte más amplio, el del último intento— y lo «cerraba» con un
// `transform: scale()` CSS. En pantalla se veía el encuadre del intento 1, pero
// la imagen que bajaba era la del intento 5: bastaba abrir F12 → Red (o pegar
// la URL en una pestaña) para ver cuatro pistas por adelantado. Y aunque el
// cliente pidiera `z=1`, cambiar el número en la URL era gratis: el servidor no
// sabía en qué intento iba quien preguntaba.
//
// AHORA cada recorte por encima del primero exige `&k=<ticket>`, un HMAC de
// (fecha, sello del coche, z). Solo lo emite el servidor, y solo cuando puede
// certificar que el jugador ha gastado los intentos que ese recorte supone:
//   - get-daily-car: con los intentos de su partida (user_guesses para el
//     logueado; el contador FIRMADO del token anónimo para el anónimo).
//   - validate-guess: al registrar un fallo, el del intento siguiente.
// Sin ticket válido, daily-image sirve el recorte del intento 1, que es lo que
// cualquiera puede ver sin haber jugado.
//
// POR QUÉ DETERMINISTA (sin usuario ni caducidad dentro). La foto se cachea en
// el CDN por URL —(d, v, z, k, w, f)— y sharp se paga una vez por variante. Un
// ticket por usuario partiría esa caché en miles de entradas y cada intento
// sería un sharp en frío. Determinista, quien tenga el ticket del intento 3 lo
// puede compartir… igual que puede compartir una captura de su pantalla: no da
// nada que su portador no haya visto ya. Lo que ya no se puede es FABRICARLO.
//
// POR QUÉ EL SELLO Y NO EL `v`. Por lo mismo que el revealToken
// (_lib/reveal-token.js): el día puede tener dos coches (cambio de emergencia)
// y el ticket tiene que abrir SOLO la revisión de su portador. daily-image
// resuelve el coche por el `v` y recalcula su sello; el ticket de otra revisión
// no casa.
//
// Web Crypto (`crypto.subtle`) para que valga igual en Edge (get-daily-car) y
// en Node (validate-guess, daily-image): Node 18+ lo trae global.

import { hmacSha256Base64Url, timingSafeEqualBytes } from "./crypto.js";

// Réplica de ZOOM_ATTEMPTS (api/_lib/zoom.js / src/lib/zoom.js, regla 7). No se
// importa para que este módulo no arrastre nada que no sea Edge-safe; el test
// comprueba que siguen iguales.
export const Z_MAX = 5;
// El recorte que se sirve SIN ticket: el del intento 1, lo que ve cualquiera.
export const Z_LIBRE = 1;

// 22 caracteres base64url = 132 bits del HMAC. Sobra para no ser adivinable y
// mantiene la URL corta (va seis veces en cada srcset).
const LARGO = 22;

const SECRET = () => process.env.REPESCA_TOKEN_SECRET || "";

const enc = new TextEncoder();

/**
 * El recorte que le corresponde a quien ha gastado `intentos` intentos sin
 * acertar: el siguiente, sin pasar del último.
 * @param {number} intentos
 */
export function zDelIntento(intentos) {
  const n = Number.isInteger(intentos) && intentos > 0 ? intentos : 0;
  return Math.min(n + 1, Z_MAX);
}

/**
 * Firma el ticket de (fecha, sello, z). Devuelve null cuando no hace falta
 * (z=1 es libre) o no se puede firmar (sin secreto o sin sello): el cliente cae
 * entonces al recorte libre, que es el fallo seguro.
 */
export async function firmarTicketImagen({ fecha, sello, z }) {
  if (!Number.isInteger(z) || z <= Z_LIBRE || z > Z_MAX) return null;
  const secret = SECRET();
  if (!secret || !sello || !fecha) return null;
  const firma = await hmacSha256Base64Url(secret, `img-z|${fecha}|${sello}|${z}`);
  return firma.slice(0, LARGO);
}

/**
 * ¿`k` es el ticket de (fecha, sello, z)? Comparación en tiempo constante.
 */
export async function verificarTicketImagen({ fecha, sello, z, k }) {
  if (typeof k !== "string" || k.length !== LARGO) return false;
  const esperado = await firmarTicketImagen({ fecha, sello, z });
  if (!esperado) return false;
  return timingSafeEqualBytes(enc.encode(esperado), enc.encode(k));
}

/**
 * Lo que viaja al cliente para pintar el intento en curso: `{ imgZ, imgK }`.
 * Con la partida cerrada no hay recorte que pedir (la foto entera va por el
 * revealToken), así que sale todo a null.
 */
export async function ticketDelIntento({ fecha, sello, intentos, jugando = true }) {
  if (!jugando) return { imgZ: null, imgK: null };
  const imgZ = zDelIntento(intentos);
  let imgK = null;
  try {
    imgK = await firmarTicketImagen({ fecha, sello, z: imgZ });
  } catch (err) {
    console.error("[image-ticket] firma:", err?.message || err);
  }
  // Sin ticket no hay recorte por encima del libre: prometerle al cliente un z
  // que el servidor no le va a dar le haría pintar mal la escala.
  return imgK ? { imgZ, imgK } : { imgZ: Z_LIBRE, imgK: null };
}
