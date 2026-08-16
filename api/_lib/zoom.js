// api/_lib/zoom.js
// Fuente de verdad del zoom escalonado del juego (lado SERVIDOR).
//
// Cada coche tiene un "zoom base" (cars.zoom_base) = el zoom lógico del
// intento 1. Los 5 intentos NO bajan en saltos lineales fijos: interpolamos en
// espacio LOG entre los extremos —intento 1 = base, intento 5 = base-2—
// deformando el progreso con ZOOM_EASE. ZOOM_STEP define el SPAN de los
// extremos, no un salto fijo: intento 5 sigue siendo base - STEP*(ATTEMPTS-1).
//
// ── POR QUÉ ESTA CURVA ES BACK-LOADED (EASE > 1) ──────────────────────────
// El género (Wordle, Heardle: 1s→2s→4s→7s→11s→16s) reparte las pistas en
// aceleración, no en desaceleración: la tensión tiene que subir hasta el
// último intento y la pista más generosa es la que rescata al jugador que ya
// se veía perdido. Con EASE<1 (ease-out) pasaba lo contrario — el salto grande
// era el 1→2 y el 4→5 era el más pobre, justo en el momento de máxima tensión:
// el jugador veía casi la misma foto en el intento 4 y en el 5 y el desenlace
// se sentía como un anticlímax.
//
// Con EASE 1.3 el span en log se reparte 16.5 / 24.1 / 28.2 / 31.2 % —pasos
// monótonamente crecientes, el último ~1.9× el primero— y ese reparto es
// IDÉNTICO para cualquier zoom_base (la curva es invariante de escala; el base
// solo cambia la magnitud total, no la forma).
//
// La propiedad que hace este cambio seguro: los EXTREMOS son fijos, así que la
// información del intento 5 es exactamente la de antes y el SUELO DE DERROTA no
// se mueve. Back-loading retrasa los aciertos hacia el 4-5 sin fabricar ni una
// sola partida perdida — que es lo que de verdad quema al jugador. Y como el
// intento 5 no cambia, tampoco cambian el crop servido, el hash de caché, la
// envolvente de seguridad (CLAUDE.md #5/#6) ni la calibración por zoom_base que
// el bucle DDA lleva meses ajustando.
//
// Ojo con el otro extremo: EASE demasiado alto adelgaza el paso 1→2 hasta
// hacerlo imperceptible ("he gastado un intento para nada"). 1.3 deja el paso
// más pequeño en un 66% del geométrico, que se sigue notando. zoom.sync.test.js
// fija estas invariantes de forma para que no se pierdan en el próximo retoque.
//
// El recorte que sirve daily-image.js para el intento z es 1/zoom_z del lado
// menor de la imagen. El servidor solo entrega el crop del intento 5 (el más
// amplio, 1/(base-2)) durante la partida; el cliente cierra el resto con CSS.
//
// COHERENCIA (CLAUDE.md #7): el lado cliente replica esta fórmula en
// src/lib/zoom.js. Si cambias STEP / ATTEMPTS / EASE / rango aquí, cámbialo allí.

export const DEFAULT_ZOOM_BASE = 3.7; // intento 1 histórico (3.7×)
export const ZOOM_STEP = 0.5; // define el span de los extremos: zoom_N = base - STEP*(N-1)
export const ZOOM_ATTEMPTS = 5; // nº de intentos / pistas
export const ZOOM_EASE = 1.3; // exponente de la curva log: 1 = geométrico (pasos iguales); >1 = ease-in (back-loaded, el salto grande al final)
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
// quedan EXACTOS para cualquier EASE (en z=1, t=0; en z=N, t=1) — es justo esa
// propiedad la que permite retocar la curva sin mover la dificultad calibrada.
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
