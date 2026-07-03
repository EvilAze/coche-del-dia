// api/_lib/blur.js
// Fuente de verdad del desenfoque escalonado del modo "Túnel de viento"
// (lado SERVIDOR).
//
// El túnel usa el mismo truco de seguridad que el zoom del juego diario, pero
// con blur: el desenfoque gaussiano COMPONE (blur σ1 sobre blur σ2 ≈ blur
// √(σ1²+σ2²)), así que el servidor hornea SOLO el sigma del último intento
// (el estado más revelador que un jugador legítimo puede ganarse) y el
// cliente AÑADE blur CSS encima para los intentos anteriores. Quien pele el
// CSS con DevTools ve exactamente lo que vería en el intento 5 — nunca más.
// Una sola imagen por partida → cacheable en CDN por coche, sharp corre una
// vez por (coche, tamaño, formato), no una vez por jugador.
//
// Los sigmas se expresan como PORCENTAJE del ancho de la imagen, no en px:
// así el nivel percibido es el mismo aunque el servidor sirva 640 o 1280 y
// el cliente lo pinte a 350 o 448 px (el blur horneado escala con la imagen
// al reescalarla el navegador; el CSS se calcula sobre el ancho renderizado).
//
// Calibración: el thumb bloqueado del garaje usa sigma ≈ 3.1% del ancho
// ("silueta reconocible, detalles ilegibles" — ver api/car-image.js). El
// intento 1 arranca ahí; el intento 5 baja a 0.55% (legible pero blando).
// La curva es log-lerp con easing, igual que el zoom (Weber-Fechner): cada
// pista se siente como el mismo salto proporcional de nitidez.
//
// COHERENCIA (CLAUDE.md #7, mismo criterio que zoom.js): el lado cliente
// replica esta fórmula en src/lib/blur.js y src/lib/blur.sync.test.js rompe
// el CI si divergen. Si cambias constantes o fórmula aquí, cámbialas allí.

export const BLUR_ATTEMPTS = 5; // nº de intentos / niveles de enfoque
export const BLUR_START_PCT = 3.2; // sigma del intento 1, % del ancho
export const BLUR_END_PCT = 0.55; // sigma del intento 5 (el horneado en servidor)
export const BLUR_EASE = 0.85; // <1 = ease-out (aclara más al principio)

// Sigma lógico (en % del ancho) del intento z (1..ATTEMPTS). Log-lerp entre
// los extremos con el progreso deformado por BLUR_EASE. Extremos exactos.
export function sigmaPctForAttempt(z) {
  if (BLUR_ATTEMPTS <= 1) return BLUR_START_PCT;
  const t = (z - 1) / (BLUR_ATTEMPTS - 1);
  const f = Math.pow(t, BLUR_EASE);
  return Math.exp(
    Math.log(BLUR_START_PCT) +
      f * (Math.log(BLUR_END_PCT) - Math.log(BLUR_START_PCT))
  );
}

// Sigma en píxeles que sharp hornea en la imagen servida de `width` px de
// ancho. Es SIEMPRE el del último intento: el cliente cierra el resto con
// CSS. Clamp inferior a 0.3 — mínimo que acepta sharp.blur().
export function serverSigmaPx(width) {
  return Math.max(0.3, (BLUR_END_PCT / 100) * width);
}

// Blur EXTRA en px CSS que el cliente añade sobre la imagen ya horneada para
// el intento z, dado el ancho RENDERIZADO del contenedor. Deriva de la
// composición gaussiana: total² = horneado² + css² → css = √(σz² - σN²).
// En el último intento devuelve 0 (la imagen servida ya es el nivel exacto).
export function cssBlurPxForAttempt(z, containerPx) {
  const target = sigmaPctForAttempt(z);
  const baked = BLUR_END_PCT;
  const extraPct = Math.sqrt(Math.max(0, target * target - baked * baked));
  return (extraPct / 100) * containerPx;
}
