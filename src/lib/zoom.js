// src/lib/zoom.js
// Fuente de verdad del zoom escalonado del juego (lado CLIENTE). Réplica de
// api/_lib/zoom.js (CLAUDE.md #7) — si cambias una, cambia la otra.
//
// Cada coche tiene un "zoom base" (= zoom lógico del intento 1) y TODOS revelan
// el mismo factor total: zoom_N = base / ZOOM_SPAN. Entre medias la curva es
// log-lerp deformada por ZOOM_EASE (ease-in: los pasos crecen hacia el final).
// El servidor sirve SIEMPRE el crop del intento N durante la partida; el
// cliente "cierra" el zoom con un scale CSS por intento sobre esa imagen.
//
// El razonamiento de diseño completo (por qué back-loaded y por qué el span es
// un RATIO y no una resta) está en la cabecera de api/_lib/zoom.js.

export const DEFAULT_ZOOM_BASE = 3.7;
// Factor total de revelado, idéntico para todo coche: zoom_N = base / SPAN.
// El valor ancla el comportamiento histórico del base por defecto (3.7 → 1.7),
// que es el 83% del catálogo, para que la migración solo mueva los tuneados.
export const ZOOM_SPAN = 3.7 / 1.7;
export const ZOOM_ATTEMPTS = 5;
export const ZOOM_EASE = 1.3;
export const ZOOM_BASE_MIN = 2.8;
export const ZOOM_BASE_MAX = 7.5;

// Normaliza un zoom_base a número válido en rango. null/NaN → default (compat
// con coches sin la columna).
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

// Zoom lógico del intento z (1..ATTEMPTS). Curva logarítmica con easing sobre
// un span constante: zoom = base · SPAN^(-f), con f = t^EASE y t el progreso
// normalizado. En z=1 (t=0, f=0) da base exacto; en z=N (t=1, f=1) da
// base/SPAN exacto. Que el span sea un factor y no una resta es lo que hace la
// curva invariante de escala: el base cambia la magnitud, nunca la forma.
export function zoomForAttempt(z, base = DEFAULT_ZOOM_BASE) {
  const b = clampZoomBase(base);
  if (ZOOM_ATTEMPTS <= 1) return b;
  const t = (z - 1) / (ZOOM_ATTEMPTS - 1); // progreso normalizado 0..1
  const f = Math.pow(t, ZOOM_EASE); // easing (>1 = ease-in / back-loaded)
  return b * Math.pow(ZOOM_SPAN, -f);
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
// no divergir de la curva (CLAUDE.md #7). Con EASE 1.3 da
// [2.176, 1.914, 1.587, 1.275, 1.0].
//
// Desde que el span es un ratio, el `base` se CANCELA en la división y los
// scales son los mismos para todo coche. Se mantiene el parámetro porque los
// call sites lo pasan, pero de paso mata toda una clase de bug: la de que el
// servidor recortara con un base y el cliente escalara con otro (ver el test
// "el previo del admin muestra lo mismo que el juego").
export function cssZoomLevels(base = DEFAULT_ZOOM_BASE) {
  const end = zoomForAttempt(ZOOM_ATTEMPTS, base);
  return Array.from({ length: ZOOM_ATTEMPTS }, (_, i) =>
    zoomForAttempt(i + 1, base) / end
  );
}
