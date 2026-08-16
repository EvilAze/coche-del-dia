// src/lib/zoom.js
// Fuente de verdad del zoom escalonado del juego (lado CLIENTE). Réplica de
// api/_lib/zoom.js (CLAUDE.md #7) — si cambias una, cambia la otra.
//
// Cada coche tiene un "zoom base" (= zoom lógico del intento 1). La curva es
// LOGARÍTMICA CON EASING: log-lerp entre intento 1 (= base) e intento 5
// (= base-2), deformada por ZOOM_EASE (ease-IN: los pasos CRECEN hacia el
// final). ZOOM_STEP define el span de los extremos, no un salto fijo. El
// servidor sirve SIEMPRE el crop del intento 5 (1/(base-2)) durante la partida;
// el cliente "cierra" el zoom con un scale CSS por intento sobre esa imagen.
// Los extremos son fijos: solo se redistribuyen los intentos intermedios.

export const DEFAULT_ZOOM_BASE = 3.7;
export const ZOOM_STEP = 0.5;
export const ZOOM_ATTEMPTS = 5;
export const ZOOM_EASE = 1.3;
export const ZOOM_BASE_MIN = 3.2;
export const ZOOM_BASE_MAX = 6.0;

// Normaliza un zoom_base a número válido en rango. null/NaN → default (compat
// con coches sin la columna).
export function clampZoomBase(value) {
  // `null` (columna vacía en Postgres) y `""` no son "un número fuera de
  // rango", son "no hay dato": Number() los convierte a 0, que SÍ es finito, y
  // por eso caían al MIN (3.2) en vez de al default (3.7) que promete la línea
  // de arriba. Un coche sin zoom_base se jugaba más fácil de lo previsto.
  if (value === null || value === "") return DEFAULT_ZOOM_BASE;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_ZOOM_BASE;
  if (n < ZOOM_BASE_MIN) return ZOOM_BASE_MIN;
  if (n > ZOOM_BASE_MAX) return ZOOM_BASE_MAX;
  return n;
}

// Zoom lógico del intento z (1..ATTEMPTS). Curva logarítmica con easing:
// log-lerp entre intento 1 (= base) e intento N (= base - STEP*(N-1)), con el
// progreso deformado por ZOOM_EASE. Extremos exactos para cualquier EASE — de
// eso depende que tocar EASE no mueva la dificultad calibrada (ver cabecera).
export function zoomForAttempt(z, base = DEFAULT_ZOOM_BASE) {
  const b = clampZoomBase(base);
  if (ZOOM_ATTEMPTS <= 1) return b;
  const zEnd = b - ZOOM_STEP * (ZOOM_ATTEMPTS - 1); // zoom del intento N (extremo)
  const t = (z - 1) / (ZOOM_ATTEMPTS - 1); // progreso normalizado 0..1
  const f = Math.pow(t, ZOOM_EASE); // easing (>1 = ease-in / back-loaded)
  return Math.exp(Math.log(b) + f * (Math.log(zEnd) - Math.log(b)));
}

// Porcentaje del lado menor recortado para el intento z (para las previews del
// admin). 1/zoom, acotado a [0.05, 0.95].
export function cropPctForAttempt(z, base = DEFAULT_ZOOM_BASE) {
  const pct = 1 / zoomForAttempt(z, base);
  return Math.max(0.05, Math.min(0.95, pct));
}

// Scales CSS por intento (1..N) que el cliente aplica sobre la imagen ?z=N que
// sirve el servidor (= crop del intento N). scale_i = zoom_i / zoom_N, así el
// intento N queda en 1.0 (ya se ve todo el crop). Deriva de zoomForAttempt para
// no divergir de la curva (CLAUDE.md #7). Con la curva ease-in (EASE 1.3) y
// base=3.7 da [2.176, 1.914, 1.587, 1.275, 1.0]. El scale del intento 1 es
// base/(base-STEP*(N-1)) y NO depende de EASE (los extremos son fijos): por eso
// el `sizes` de CarImage.jsx sigue valiendo aunque se retoque la curva.
export function cssZoomLevels(base = DEFAULT_ZOOM_BASE) {
  const end = zoomForAttempt(ZOOM_ATTEMPTS, base);
  return Array.from({ length: ZOOM_ATTEMPTS }, (_, i) =>
    zoomForAttempt(i + 1, base) / end
  );
}
