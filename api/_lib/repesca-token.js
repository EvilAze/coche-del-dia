// api/_lib/repesca-token.js
// Pseudo-id determinista por (user, car) para uso en el flujo de repesca.
//
// Motivación: en modo repesca el cliente necesita identificar al servidor
// qué coche está jugando. Si usásemos el cars.id real ahí, cualquier
// atacante podría cruzarlo con /api/list-cars y obtener marca/modelo/año
// del coche objetivo, ganando trivialmente. Con el pseudo-id:
//   - El cliente nunca ve el cars.id real para coches que no ha ganado.
//   - El pseudo es opaco frente a /api/list-cars (allí los ids son reales).
//   - Es determinista para el mismo (user, car), así que refresh y
//     reanudación funcionan sin estado adicional.
//
// Carpeta `_lib` (prefijada con `_`): Vercel la excluye del routing
// automático de funciones serverless, así que NO se publica como endpoint.

import crypto from "crypto";

const SECRET = process.env.REPESCA_TOKEN_SECRET || "";

/**
 * Calcula el pseudo-id (24 hex chars, 96 bits) que se le muestra al
 * cliente para un (carId, userId) concreto. Determinista.
 *
 * Lanza si REPESCA_TOKEN_SECRET no está configurado en el entorno —
 * mejor fallar ruidoso que servir tokens inseguros con un secreto vacío.
 */
export function pseudoIdFor(carId, userId) {
  if (!SECRET) {
    throw new Error("REPESCA_TOKEN_SECRET not configured");
  }
  if (!carId || !userId) return null;
  return crypto
    .createHmac("sha256", SECRET)
    .update(`${userId}:${carId}`)
    .digest("hex")
    .slice(0, 24);
}

/**
 * Reverso: dado un pseudo recibido del cliente, encuentra el cars.id
 * real correspondiente para este usuario.
 *
 * Itera la lista de candidatos comparando HMAC. O(N) sobre el catálogo
 * entero (~200 coches): microsegundos. No necesita estado persistente
 * porque el pseudo se deriva determinísticamente del par.
 *
 * Devuelve null si el pseudo no matchea ningún coche del catálogo (input
 * inválido del cliente).
 */
export function resolveRealCarId(pseudo, userId, candidateCarIds) {
  if (typeof pseudo !== "string" || pseudo.length === 0) return null;
  if (!userId) return null;
  for (const carId of candidateCarIds || []) {
    if (pseudoIdFor(carId, userId) === pseudo) return carId;
  }
  return null;
}
