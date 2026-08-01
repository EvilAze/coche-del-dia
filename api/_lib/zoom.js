// api/_lib/zoom.js
// Fuente de verdad del zoom escalonado del juego (lado SERVIDOR).
//
// Cada coche tiene un "zoom base" (cars.zoom_base) = el zoom lógico del
// intento 1. Antes los 5 intentos bajaban en saltos LINEALES fijos
// (base - 0.5*(i-1)); ahora la curva es LOGARÍTMICA CON EASING: interpolamos
// en espacio log entre los extremos —intento 1 = base, intento 5 = base-2—,
// deformada por ZOOM_EASE. Razón: que cada pista se sienta como el mismo
// progreso proporcional (Weber-Fechner) y adelantar el "Aha!" al intento 3-4.
// ZOOM_STEP define el SPAN de los extremos (no un salto fijo): intento 5 sigue
// siendo base - STEP*(ATTEMPTS-1), idéntico a la versión lineal.
//
// El recorte que sirve daily-image.js para el intento z es 1/zoom_z del lado
// menor de la imagen. El servidor solo entrega el crop del intento 5 (el más
// amplio, 1/(base-2)) durante la partida; el cliente cierra el resto con CSS.
// Como los EXTREMOS no cambian, el crop del intento 5 y la calibración de
// dificultad por zoom_base se mantienen: solo se redistribuyen los intermedios.
//
// COHERENCIA (CLAUDE.md #7): el lado cliente replica esta fórmula en
// src/lib/zoom.js. Si cambias STEP / ATTEMPTS / EASE / rango aquí, cámbialo allí.

export const DEFAULT_ZOOM_BASE = 3.7; // intento 1 histórico (3.7×)
export const ZOOM_STEP = 0.5; // define el span de los extremos: zoom_N = base - STEP*(N-1)
export const ZOOM_ATTEMPTS = 5; // nº de intentos / pistas
export const ZOOM_EASE = 0.7; // exponente de la curva log: 1 = geométrico puro; <1 = ease-out (revela antes)
export const ZOOM_BASE_MIN = 3.2; // intento 5 = 1.2× → muestra ~83% (más fácil)
export const ZOOM_BASE_MAX = 6.0; // intento 5 = 4.0× → muestra ~25% (más difícil)

// Normaliza un zoom_base (de la BD o del body admin) a un número válido dentro
// de rango. null/NaN → default, para compatibilidad con coches anteriores a la
// columna (se comportan como antes: base 3.7).
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

// Zoom lógico del intento z (1..ATTEMPTS) para un coche con este base.
// Curva logarítmica con easing: log-lerp entre intento 1 (= base) e intento N
// (= base - STEP*(N-1)), con el progreso deformado por ZOOM_EASE. Los extremos
// quedan EXACTOS para cualquier EASE (en z=1, t=0; en z=N, t=1).
export function zoomForAttempt(z, base = DEFAULT_ZOOM_BASE) {
  const b = clampZoomBase(base);
  if (ZOOM_ATTEMPTS <= 1) return b;
  const zEnd = b - ZOOM_STEP * (ZOOM_ATTEMPTS - 1); // zoom del intento N (extremo)
  const t = (z - 1) / (ZOOM_ATTEMPTS - 1); // progreso normalizado 0..1
  const f = Math.pow(t, ZOOM_EASE); // easing (ease-out con EASE<1)
  return Math.exp(Math.log(b) + f * (Math.log(zEnd) - Math.log(b)));
}

// Porcentaje del lado menor que el servidor recorta para el intento z. Es
// 1/zoom, acotado a [0.05, 0.95] como red de seguridad: ni siquiera el intento
// 5 del coche más fácil revela la imagen entera durante la partida.
export function cropPctForAttempt(z, base = DEFAULT_ZOOM_BASE) {
  const pct = 1 / zoomForAttempt(z, base);
  return Math.max(0.05, Math.min(0.95, pct));
}
