// src/lib/blur.js
// Fuente de verdad del desenfoque escalonado del "Túnel de viento" (lado
// CLIENTE). Réplica de api/_lib/blur.js (CLAUDE.md #7) — si cambias una,
// cambia la otra; src/lib/blur.sync.test.js rompe el CI si divergen.
//
// El servidor hornea SOLO el sigma del último intento (mode=g de
// /api/car-image); el cliente añade blur CSS encima para los intentos
// anteriores. El gaussiano compone (total² = horneado² + css²), así que quien
// quite el CSS con DevTools ve exactamente el nivel del intento 5 — el mismo
// principio que el crop ?z=5 + scale CSS del juego diario. Los sigmas son
// % del ancho para que el nivel percibido no dependa de a qué tamaño se
// sirva ni se renderice la imagen.

export const BLUR_ATTEMPTS = 5;
export const BLUR_START_PCT = 3.2;
export const BLUR_END_PCT = 0.55;
export const BLUR_EASE = 0.85;

// Sigma lógico (% del ancho) del intento z (1..ATTEMPTS). Log-lerp con easing
// entre extremos, idéntico en forma a zoomForAttempt (Weber-Fechner).
export function sigmaPctForAttempt(z) {
  if (BLUR_ATTEMPTS <= 1) return BLUR_START_PCT;
  const t = (z - 1) / (BLUR_ATTEMPTS - 1);
  const f = Math.pow(t, BLUR_EASE);
  return Math.exp(
    Math.log(BLUR_START_PCT) +
      f * (Math.log(BLUR_END_PCT) - Math.log(BLUR_START_PCT))
  );
}

// Sigma en px que el servidor hornea para un ancho de imagen dado. En cliente
// solo lo usa el test de sincronía; la app consume cssBlurPxForAttempt.
export function serverSigmaPx(width) {
  return Math.max(0.3, (BLUR_END_PCT / 100) * width);
}

// Blur EXTRA (px CSS) que se aplica sobre la imagen servida para el intento z,
// dado el ancho RENDERIZADO del contenedor. 0 en el último intento.
export function cssBlurPxForAttempt(z, containerPx) {
  const target = sigmaPctForAttempt(z);
  const baked = BLUR_END_PCT;
  const extraPct = Math.sqrt(Math.max(0, target * target - baked * baked));
  return (extraPct / 100) * containerPx;
}
