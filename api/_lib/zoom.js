// api/_lib/zoom.js
// Fuente de verdad del zoom escalonado del juego (lado SERVIDOR).
//
// Cada coche tiene un "zoom base" (cars.zoom_base) = el zoom lógico del
// intento 1. Los 5 intentos bajan en saltos fijos de ZOOM_STEP:
//   intento i (1..5) → zoom_i = base - ZOOM_STEP*(i-1)
// El recorte que sirve daily-image.js para el intento z es 1/zoom_z del lado
// menor de la imagen. El servidor solo entrega el crop del intento 5 (el más
// amplio, 1/(base-2)) durante la partida; el cliente cierra el resto con CSS.
//
// COHERENCIA (CLAUDE.md #7): el lado cliente replica esta fórmula en
// src/lib/zoom.js. Si cambias STEP / ATTEMPTS / rango aquí, cámbialo allí.

export const DEFAULT_ZOOM_BASE = 3.7; // intento 1 histórico (3.7×)
export const ZOOM_STEP = 0.5; // salto de zoom entre intentos
export const ZOOM_ATTEMPTS = 5; // nº de intentos / pistas
export const ZOOM_BASE_MIN = 3.2; // intento 5 = 1.2× → muestra ~83% (más fácil)
export const ZOOM_BASE_MAX = 6.0; // intento 5 = 4.0× → muestra ~25% (más difícil)

// Normaliza un zoom_base (de la BD o del body admin) a un número válido dentro
// de rango. null/NaN → default, para compatibilidad con coches anteriores a la
// columna (se comportan como antes: base 3.7).
export function clampZoomBase(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_ZOOM_BASE;
  if (n < ZOOM_BASE_MIN) return ZOOM_BASE_MIN;
  if (n > ZOOM_BASE_MAX) return ZOOM_BASE_MAX;
  return n;
}

// Zoom lógico del intento z (1..5) para un coche con este base.
export function zoomForAttempt(z, base = DEFAULT_ZOOM_BASE) {
  return clampZoomBase(base) - ZOOM_STEP * (z - 1);
}

// Porcentaje del lado menor que el servidor recorta para el intento z. Es
// 1/zoom, acotado a [0.05, 0.95] como red de seguridad: ni siquiera el intento
// 5 del coche más fácil revela la imagen entera durante la partida.
export function cropPctForAttempt(z, base = DEFAULT_ZOOM_BASE) {
  const pct = 1 / zoomForAttempt(z, base);
  return Math.max(0.05, Math.min(0.95, pct));
}
