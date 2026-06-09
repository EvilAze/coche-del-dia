// src/lib/zoom.js
// Fuente de verdad del zoom escalonado del juego (lado CLIENTE). Réplica de
// api/_lib/zoom.js (CLAUDE.md #7) — si cambias una, cambia la otra.
//
// Cada coche tiene un "zoom base" (= zoom lógico del intento 1). Los 5 intentos
// bajan en saltos fijos: zoom_i = base - ZOOM_STEP*(i-1). El servidor sirve
// SIEMPRE el crop del intento 5 (1/(base-2)) durante la partida; el cliente
// "cierra" el zoom con un scale CSS por intento sobre esa imagen.

export const DEFAULT_ZOOM_BASE = 3.7;
export const ZOOM_STEP = 0.5;
export const ZOOM_ATTEMPTS = 5;
export const ZOOM_BASE_MIN = 3.2;
export const ZOOM_BASE_MAX = 6.0;

// Normaliza un zoom_base a número válido en rango. null/NaN → default (compat
// con coches sin la columna).
export function clampZoomBase(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_ZOOM_BASE;
  if (n < ZOOM_BASE_MIN) return ZOOM_BASE_MIN;
  if (n > ZOOM_BASE_MAX) return ZOOM_BASE_MAX;
  return n;
}

// Zoom lógico del intento z (1..5).
export function zoomForAttempt(z, base = DEFAULT_ZOOM_BASE) {
  return clampZoomBase(base) - ZOOM_STEP * (z - 1);
}

// Porcentaje del lado menor recortado para el intento z (para las previews del
// admin). 1/zoom, acotado a [0.05, 0.95].
export function cropPctForAttempt(z, base = DEFAULT_ZOOM_BASE) {
  const pct = 1 / zoomForAttempt(z, base);
  return Math.max(0.05, Math.min(0.95, pct));
}

// Scales CSS por intento (1..5) que el cliente aplica sobre la imagen ?z=5 que
// sirve el servidor (= crop del intento 5). scale_i = zoom_i / zoom_5, así el
// intento 5 queda en 1.0 (ya se ve todo el crop). Para base=3.7 reproduce
// exactamente [2.176, 1.882, 1.588, 1.294, 1.0].
export function cssZoomLevels(base = DEFAULT_ZOOM_BASE) {
  const b = clampZoomBase(base);
  const end = b - ZOOM_STEP * (ZOOM_ATTEMPTS - 1); // zoom del intento 5
  return Array.from({ length: ZOOM_ATTEMPTS }, (_, i) => (b - ZOOM_STEP * i) / end);
}
