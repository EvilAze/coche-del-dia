// api/_lib/zoom.js
// Fuente de verdad del zoom escalonado del juego (lado SERVIDOR).
//
// Cada coche tiene un "zoom base" (cars.zoom_base) = el zoom lógico del
// intento 1. Los 5 intentos NO bajan en saltos lineales: la curva es
// zoom = base · ZOOM_SPAN^(-f), con f = t^ZOOM_EASE y t el progreso 0..1.
//
// ── POR QUÉ EL SPAN ES UN RATIO Y NO UNA RESTA ────────────────────────────
// Antes el intento 5 era `base - 2.0`, una resta FIJA, así que el revelado
// total dependía del base: un coche a 3.2 abría ×2.67 y uno a 6.0 solo ×1.50.
// El coche difícil no era "difícil", era MUDO: pasaba de enseñar el 2.8% del
// área al 6.3% en cinco intentos y sus pasos eran de ×1.08, invisibles. El
// jugador no percibía que el juego le estuviera dando nada y se iba.
//
// Con un span constante todo coche revela el MISMO factor total y el zoom_base
// pasa a significar solo una cosa —cuánto se cierra el teaser inicial— en vez
// de dos cosas a la vez (teaser + cuánta cuerda te doy después). La curva
// queda además invariante de escala: el reparto de los pasos es idéntico para
// cualquier base, y el slider del admin ya no deforma la curva al moverse.
//
// ── POR QUÉ ESTA CURVA ES BACK-LOADED (EASE > 1) ──────────────────────────
// El género (Wordle, Heardle: 1s→2s→4s→7s→11s→16s) reparte las pistas en
// aceleración, no en desaceleración: la tensión tiene que subir hasta el
// último intento y la pista más generosa es la que rescata al jugador que ya
// se veía perdido. Con EASE<1 (ease-out) pasaba lo contrario — el salto grande
// era el 1→2 y el 4→5 el más pobre, justo en el momento de máxima tensión.
//
// Con EASE 1.3 el span en log se reparte 16.5 / 24.1 / 28.2 / 31.2 % — pasos
// monótonamente crecientes, el último ~1.9× el primero. Ojo con pasarse: un
// EASE más alto adelgaza el paso 1→2 hasta hacerlo imperceptible ("he gastado
// un intento para nada"). 1.3 lo deja en el 66% del geométrico, que se nota.
// zoom.sync.test.js fija estas invariantes de forma.
//
// ── EL ANCLA DE ZOOM_SPAN ─────────────────────────────────────────────────
// SPAN = 3.7/1.7 es exactamente el span histórico del base por defecto, que es
// el 83% del catálogo (367 de 441 coches al migrar). Así los coches sin tunear
// se comportan IGUAL que siempre y la migración solo mueve los ~74 ajustados a
// mano. Ver scripts/2026-08-zoom-span-ratio.sql.
//
// El recorte que sirve daily-image.js para el intento z es 1/zoom_z del lado
// menor de la imagen. El servidor solo entrega el crop del intento 5 (el más
// amplio) durante la partida; el cliente cierra el resto con CSS.
//
// COHERENCIA (CLAUDE.md #7): el lado cliente replica esta fórmula en
// src/lib/zoom.js. Si cambias SPAN / ATTEMPTS / EASE / rango aquí, cámbialo allí.

export const DEFAULT_ZOOM_BASE = 3.7; // intento 1 histórico (3.7×)
export const ZOOM_SPAN = 3.7 / 1.7; // ≈2.1765 — factor total de revelado, igual para todo coche
export const ZOOM_ATTEMPTS = 5; // nº de intentos / pistas
export const ZOOM_EASE = 1.3; // exponente de la curva log: 1 = geométrico (pasos iguales); >1 = ease-in (back-loaded)
export const ZOOM_BASE_MIN = 2.8; // intento 1 = 35.7% del lado → intento 5 = 77.7% (fácil)
export const ZOOM_BASE_MAX = 7.5; // intento 1 = 13.3% del lado → intento 5 = 29.0% (difícil)

// Normaliza un zoom_base (de la BD o del body admin) a un número válido dentro
// de rango. null/NaN → default, para compatibilidad con coches anteriores a la
// columna (se comportan como antes: base 3.7).
export function clampZoomBase(value) {
  // `null` (columna vacía en Postgres) y `""` no son "un número fuera de
  // rango", son "no hay dato": Number() los convierte a 0, que SÍ es finito, y
  // por eso caían al MIN en vez de al default (3.7) que promete la línea de
  // arriba. Un coche sin zoom_base se jugaba más fácil de lo previsto.
  if (value === null || value === "") return DEFAULT_ZOOM_BASE;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_ZOOM_BASE;
  if (n < ZOOM_BASE_MIN) return ZOOM_BASE_MIN;
  if (n > ZOOM_BASE_MAX) return ZOOM_BASE_MAX;
  return n;
}

// Zoom lógico del intento z (1..ATTEMPTS) para un coche con este base.
// En z=1 (t=0, f=0) devuelve base exacto; en z=N (t=1, f=1), base/SPAN exacto.
// Esos extremos exactos son lo que permite retocar EASE sin mover ni el crop
// servido ni la dificultad calibrada.
export function zoomForAttempt(z, base = DEFAULT_ZOOM_BASE) {
  const b = clampZoomBase(base);
  if (ZOOM_ATTEMPTS <= 1) return b;
  const t = (z - 1) / (ZOOM_ATTEMPTS - 1); // progreso normalizado 0..1
  const f = Math.pow(t, ZOOM_EASE); // easing (>1 = ease-in / back-loaded)
  return b * Math.pow(ZOOM_SPAN, -f);
}

// Porcentaje del lado menor que el servidor recorta para el intento z. Es
// 1/zoom, acotado a [0.05, 0.95] como red de seguridad: ni siquiera el intento
// 5 del coche más fácil revela la imagen entera durante la partida.
export function cropPctForAttempt(z, base = DEFAULT_ZOOM_BASE) {
  const pct = 1 / zoomForAttempt(z, base);
  return Math.max(0.05, Math.min(0.95, pct));
}
