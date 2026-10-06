// src/lib/sorteo.js
// EL CARRETE DEL SORTEO DE LA REPESCA (RepescaDrawAnimation): cuánto gira,
// con qué curva, y cuándo pasa cada número por el centro del visor.
//
// Viven aquí, y no en el CSS, porque lo mismo lo leen DOS sitios que no
// pueden separarse: el CSS mueve el carrete con esta duración y esta curva
// (el componente se las pasa como `--giro-ms` / `--giro-curva`), y la mano
// nota un tic cada vez que un número cruza el centro. Si el tic se calculara
// con otra curva, iría por delante o por detrás del número que se ve pasar.

// Números del carrete. El último es el que toca: el carrete se detiene con él
// encuadrado.
export const FICHAS = 16;

// Lo que dura el giro: arranca rápido y frena largo. Con el visor abriéndose
// antes y el enfoque después, el sorteo entero ronda los tres segundos — lo
// que tarda el servidor en elegir y la foto en llegar, sin espera de relleno.
export const GIRO_MS = 1680;

// La curva del giro (cubic-bezier): salida casi instantánea, frenada muy larga
// y un rebote de un 3 % al final, el que hace que el número «se clave».
export const CURVA_GIRO = [0.12, 0.68, 0.2, 1.03];

export function curvaGiroCss() {
  return `cubic-bezier(${CURVA_GIRO.join(",")})`;
}

// Un tic por número… salvo los que van tan seguidos que se funden: por debajo
// de esta separación el motor de vibración no los distingue y suenan como un
// zumbido. El efecto que se busca es un trinquete que se va espaciando.
export const SEPARACION_MIN_TIC_MS = 45;

// Bezier en una dimensión (los puntos de control 0 y 1 son fijos).
function bezier(s, a1, a2) {
  return 3 * a1 * s * (1 - s) * (1 - s) + 3 * a2 * s * s * (1 - s) + s * s * s;
}

// Los instantes (ms desde que arranca el giro) en que cada número cruza el
// centro. El progreso del carrete es la `y` de la curva y el tiempo su `x`:
// para cada número se busca el parámetro en el que la `y` llega a su tramo y
// se lee la `x`. Bisección y no Newton: con el rebote final la curva no es
// monótona en `y`, y la bisección encuentra siempre el PRIMER cruce, que es el
// que se ve.
export function ticsCarrete({
  fichas = FICHAS,
  duracion = GIRO_MS,
  curva = CURVA_GIRO,
  separacion = SEPARACION_MIN_TIC_MS,
} = {}) {
  const [x1, y1, x2, y2] = curva;
  const pasos = fichas - 1;
  const tics = [];
  let ultimo = -Infinity;
  for (let k = 1; k <= pasos; k++) {
    const objetivo = k / pasos;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (bezier(mid, y1, y2) < objetivo) lo = mid;
      else hi = mid;
    }
    const t = Math.round(bezier(hi, x1, x2) * duracion);
    if (t - ultimo >= separacion) {
      tics.push(t);
      ultimo = t;
    }
  }
  return tics;
}

// Los tics como UN solo patrón de vibración, empezando en el primero:
// [tic, pausa, tic, pausa, …]. Una llamada y no quince, por lo mismo que la
// frase del veredicto: cada `navigator.vibrate` cancela al anterior, y la
// ventana de haptics.js se comería los toques del medio.
export function patronTrinquete(tics, tic = 6) {
  const patron = [];
  tics.forEach((t, i) => {
    if (i > 0) patron.push(Math.max(1, t - tics[i - 1] - tic));
    patron.push(tic);
  });
  return patron;
}
