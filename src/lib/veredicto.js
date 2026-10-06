// src/lib/veredicto.js
// LA FRASE DEL VEREDICTO, en un solo sitio: el compás con el que caen las tres
// celdas de un intento y lo que el dedo siente mientras caen.
//
// POR QUÉ EXISTE
//   El veredicto ya era una frase para la vista —marca (0) → modelo (110) →
//   año (220) → la foto abriéndose en el 280— y muda para el tacto: un fallo
//   intermedio no vibraba nada, y al acabar la partida `success`/`warning`
//   sonaban en el instante en que llegaba la respuesta, o sea ANTES de que
//   hubiera nada en pantalla. Se sentía una cosa y se veía otra un segundo
//   después. Aquí la frase se escribe una vez y la leen las dos mitades: el
//   retardo de cada celda (AttemptList) y el patrón de vibración (haptics.js).
//   Antes de esto, el 110 vivía en AttemptList y lo único que lo ataba a la foto
//   era un comentario; ahora al menos tinta y tacto no se pueden separar.
//
// UN PATRÓN, NO TRES LLAMADAS
//   Lo natural sería un `vibrate()` por celda con su setTimeout. No vale por
//   dos motivos: `navigator.vibrate` CANCELA el patrón que esté sonando, y la
//   ventana de coalescencia de haptics.js (110 ms, por peso) se comería el
//   segundo y el tercer toque, que llegan justo en su borde. Un único patrón
//   [golpe, pausa, golpe, pausa, golpe] lo resuelve el propio motor, con su
//   reloj, sin depender de que el hilo principal esté libre en el ms 110.

import { MS } from "./compas";

// El paso entre celdas. 110 y no 120 porque son los tres primeros tiempos de
// una frase de CUATRO: el cuarto es la fotografía, que arranca en `MS.sello`
// (280, el retardo de la transición en CarImage). Con 110 el último golpe cae
// en el 220 y la foto entra justo detrás; con 120 se pisaban. Si tocas esto,
// mira ese retardo: son las dos mitades del mismo compás.
export const PASO_VEREDICTO_MS = 110;

// Cuánto pesa cada celda al caer, en ms de motor (la web no deja elegir la
// intensidad, solo la duración, así que el peso ES la duración).
//   · correcto 14 — un golpe que se nota: «esto ya lo tienes».
//   · parcial  10 — la marca no es, pero es del mismo país.
//   · fallo     6 — un roce. Fallar no se castiga: se cuenta.
// Escalonados para que la frase se LEA a ciegas: tres golpes iguales y firmes
// es un acierto completo, y se distingue de un fallo sin mirar la pantalla.
// Todos por debajo del paso, o la pausa saldría negativa.
const PESO_CELDA = { correct: 14, partial: 10, wrong: 6 };

// El patrón de vibración de un intento ya juzgado por el servidor. Recibe el
// `result` tal cual lo devuelve validate-guess (o la repesca): cada campo con
// su `status`. El año no tiene parcial; su flecha no cambia el peso, porque la
// dirección ya la cuenta la flecha y el tacto solo dice «acertado o no».
export function fraseVeredicto(result) {
  const peso = (st) => PESO_CELDA[st] ?? PESO_CELDA.wrong;
  const a = peso(result?.marca?.status);
  const b = peso(result?.modelo?.status);
  const c = peso(result?.anio?.status);
  return [a, PASO_VEREDICTO_MS - a, b, PASO_VEREDICTO_MS - b, c];
}

// EL MOMENTO EN QUE EL SELLO TOCA EL PAPEL.
//
// El sello del final («Resuelto» / «Sin resolver») cae desde `scale(1.7)` con
// `--curva-sello`, que tiene rebote: llega a su tamaño ANTES de acabar la
// animación, lo sobrepasa y vuelve. Ese primer contacto es el golpe que se ve,
// y es donde tiene que sonar el que se siente — no al empezar (aún está en el
// aire) ni al terminar (ya está quieto y el golpe llegaría tarde).
//
// Resolviendo cubic-bezier(.2, 1.4, .4, 1), el progreso alcanza 1 por primera
// vez al 31 % del tiempo. `veredicto.test.js` lo recalcula leyendo la curva de
// index.css: si alguien la cambia, el test dice cuánto hay que mover esto.
export const IMPACTO_SELLO = 0.31;

// Los ms desde que EMPIEZA la animación del sello (evento `animationstart`, que
// ya descuenta su retardo) hasta el golpe. El sello dura `--ms-escena`.
export const MS_HASTA_IMPACTO_SELLO = Math.round(MS.escena * IMPACTO_SELLO);
