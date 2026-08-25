// api/_lib/sello.js
// Sello opaco de un coche para una fecha. Es la forma de que un cliente diga
// «yo venía jugando con AQUEL coche» sin que nadie pueda saber cuál era.
//
// Por qué no viaja el car_id a secas: el sello va dentro del token de sesión
// anónima, cuyo payload es base64 legible desde el navegador. Publicar ahí el
// id del coche del día permitiría cruzarlo con /api/list-cars y saber la
// respuesta sin jugar (regla 5).
//
// HMAC y no un hash pelado: sin el secreto no se puede calcular el sello de un
// coche, así que tampoco se puede ir probando los ids del catálogo hasta dar
// con el que casa.
//
// Web Crypto (no node:crypto) a propósito: este módulo lo importan tanto
// get-daily-car (runtime Edge) como validate-guess (Node), y así hay UN solo
// sello en vez de dos réplicas que puedan divergir.

import { hmacSha256Base64Url } from "./edge/crypto.js";

// 16 caracteres base64url ≈ 96 bits: de sobra para que dos coches no colisionen
// y lo bastante corto para no engordar un token que viaja en cada petición.
const LARGO = 16;

/**
 * @param {string|null} carId
 * @param {string} fecha  YYYY-MM-DD
 * @returns {Promise<string|null>} null si falta el secreto o el coche — quien
 *   lo llama debe tratar el null como «no hay sello», nunca como un sello.
 */
export async function selloDeCoche(carId, fecha) {
  const secret = process.env.REPESCA_TOKEN_SECRET || "";
  if (!secret || !carId) return null;
  const firma = await hmacSha256Base64Url(secret, `sello:${fecha}:${carId}`);
  return firma.slice(0, LARGO);
}

/**
 * Sellos de una lista de coches, como mapa carId → sello. Los endpoints lo
 * calculan y se lo pasan al resolvedor, que es puro y síncrono.
 */
export async function sellosDe(carIds, fecha) {
  // Set: prev_car_ids puede traer el mismo coche dos veces (un swap A→B→A) y
  // no vamos a firmar dos veces lo mismo. Promise.all: esto corre en el primer
  // paint, que es el único request bloqueante del juego.
  const unicos = [...new Set((carIds || []).filter(Boolean))];
  const sellos = await Promise.all(unicos.map((id) => selloDeCoche(id, fecha)));
  return Object.fromEntries(unicos.map((id, i) => [id, sellos[i]]));
}
