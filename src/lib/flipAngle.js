// src/lib/flipAngle.js
// Matemática PURA del volteo de una portada arrastrando con el dedo.
//
// El ángulo se lleva como número acumulado (0, 180, 360, -180…) y no como un
// booleano «girada sí/no». Con un booleano, una carta que acabas de voltear
// hacia la izquierda (−180°) y que luego marcas como «girada» (+180°) daría un
// giro completo de 360° para quedarse donde ya estaba: el dedo va hacia un lado
// y la carta se va por el otro. Acumular respeta la dirección real del gesto.

// Fracción del ancho que hay que arrastrar para que el volteo se complete al
// soltar. 28 % es el punto donde el gesto ya se lee como intención y no como
// titubeo; por debajo, la carta vuelve a su sitio.
export const FLIP_COMMIT_RATIO = 0.28;
// Tope en píxeles para pantallas grandes: en un panel ancho, el 28 % serían
// varios centímetros de arrastre y el gesto se haría cansino.
export const FLIP_COMMIT_MAX_PX = 90;

export function commitThreshold(width) {
  const w = Number.isFinite(width) && width > 0 ? width : 1;
  return Math.min(FLIP_COMMIT_MAX_PX, w * FLIP_COMMIT_RATIO);
}

// Ángulo EN VIVO mientras el dedo arrastra: la carta sigue al dedo 1:1, de
// modo que recorrer el ancho entero equivale a media vuelta. Se limita a ±180°
// desde el ángulo asentado para que un arrastre largo no encadene varias
// vueltas — girar dos veces deja la carta como estaba y parece un fallo.
export function liveAngle(settled, dx, width) {
  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const delta = Number.isFinite(dx) ? dx : 0;
  const clamped = Math.max(-w, Math.min(w, delta));
  // Signo negativo: arrastrar a la derecha empuja el borde derecho hacia
  // dentro, que es como se voltea una carta sujetándola con la mano.
  return settled - (clamped / w) * 180;
}

// Ángulo al que asentar cuando se suelta: media vuelta en la dirección del
// gesto si se superó el umbral, o vuelta a la posición de partida si no.
export function settleAngle(settled, dx, width) {
  const delta = Number.isFinite(dx) ? dx : 0;
  if (Math.abs(delta) < commitThreshold(width)) return settled;
  return settled + (delta > 0 ? -180 : 180);
}

// ¿Qué cara mira al usuario en este ángulo? Sirve tanto para el estado asentado
// como durante el arrastre: la cara cambia al cruzar los 90°, que es justo
// donde el navegador cambia también la que pinta (backface-visibility).
export function showsBack(angle) {
  const a = Number.isFinite(angle) ? angle : 0;
  // Normalizamos a [0, 360) y miramos si estamos en la mitad "de dorso".
  const norm = ((a % 360) + 360) % 360;
  return norm > 90 && norm < 270;
}
