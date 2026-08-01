// src/lib/haptics.js
// Vocabulario semántico de feedback háptico para toda la app.
//
// Por qué un módulo central:
//   Antes había 3 copias de `triggerHaptic` (Repesca.jsx, hooks/useGame.js,
//   components/GuessForm.jsx) con números mágicos esparcidos: cambiar el
//   "feel" requería tocar varios sitios y era fácil que se desincronizaran.
//   Aquí definimos un único vocabulario inspirado en el de iOS
//   (UIImpactFeedbackGenerator / UINotificationFeedbackGenerator) y los
//   componentes solo llaman al nombre semántico (`haptic.selection()`),
//   no al patrón concreto.
//
// Sobre el "premium feel":
//   Los pulsos largos (>80 ms) se sienten "buzzy" y baratos. Los staccato
//   cortos (8-25 ms) y las secuencias rítmicas son lo que la gente asocia
//   con "haptic premium" (Taptic Engine de Apple, Pixel Haptics). Por eso
//   los patrones aquí son cortos por defecto.
//
// Soporte real:
//   - Android Chrome/Firefox/Edge: sí (navegador + permiso implícito).
//   - iOS Safari: NO. Apple lleva años bloqueando navigator.vibrate por
//     política de privacidad/anti-fingerprinting. En iOS estas llamadas
//     son no-op silenciosas — no rompen nada pero tampoco se sienten.
//     La sensación "táctil" en iOS la cubrimos con micro-animaciones CSS
//     sincronizadas (scale, shake) en los componentes que las usan.
//
// Preferencias del usuario:
//   - `prefers-reduced-motion: reduce` → desactivamos todos los hápticos.
//     Algunas personas tienen sensibilidad vestibular o trastornos
//     neurológicos que hacen que la vibración les resulte incómoda; la
//     misma media query que evita las animaciones se aplica aquí.
//
// Aquí hubo además un interruptor propio en localStorage (`cocheDia_haptics`)
// con `setHapticsEnabled()` / `areHapticsEnabled()` "para un futuro panel de
// ajustes". Ese panel no llegó, así que el trío era un ajuste que nadie podía
// tocar: nada escribía la clave y por tanto la lectura siempre decía lo mismo.
// La preferencia que SÍ existe de verdad —reduced-motion— ya se respeta, y es
// además la que el usuario configura una vez para todo el sistema. Si algún día
// hay ajustes en la app, el sitio de ese toggle es el ajuste, no este módulo.

// Patrones (ms). Single number = pulso simple. Array = pulso/pausa/pulso/...
//
// Diseño:
//   - selection: 8 ms. Para "tick" de elección (autocomplete, segment switch).
//     Tan corto que se percibe como un "click" más que como vibración.
//   - impactLight: 10 ms. Tap de confirmación leve (apertura de modal,
//     desbloqueo de pista).
//   - impactMedium: 18 ms. Tap claro (botón principal, envío de form).
//   - impactHeavy: 28 ms. Para acciones con peso (reset, confirmar borrado).
//   - success: 3 toques en crescendo. Suena a "logrado", no a alarma.
//   - warning: 2 toques iguales. "Algo va mal pero no es fatal" (intento
//     repetido, validación lado cliente).
//   - error: 3 toques iguales rápidos. Más insistente; reservado para
//     fallos reales (red, servidor, no se pudo procesar).
const PATTERNS = {
  selection: 8,
  impactLight: 10,
  impactMedium: 18,
  impactHeavy: 28,
  success: [12, 60, 18, 40, 25],
  warning: [18, 60, 18],
  error: [22, 40, 22, 40, 22],
};

function isReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function canVibrate() {
  return (
    typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
  );
}

// Pequeño throttle: dos pattern calls a <30 ms se solapan en algunos
// dispositivos Android y se pierden. Si llamas dos veces casi a la vez
// (p.ej. validation error + toast push), nos quedamos con el primero.
let lastFireAt = 0;
function shouldFire() {
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
  if (now - lastFireAt < 30) return false;
  lastFireAt = now;
  return true;
}

function fire(pattern) {
  if (!canVibrate()) return;
  if (isReducedMotion()) return;
  if (!shouldFire()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Algunos navegadores tiran si el patrón es inválido — silencioso.
  }
}

// API pública. Cada método nombra una *intención*, no un patrón concreto.
// Si en el futuro afinamos los números, los call sites no se enteran.
export const haptic = {
  selection: () => fire(PATTERNS.selection),
  impactLight: () => fire(PATTERNS.impactLight),
  impactMedium: () => fire(PATTERNS.impactMedium),
  impactHeavy: () => fire(PATTERNS.impactHeavy),
  success: () => fire(PATTERNS.success),
  warning: () => fire(PATTERNS.warning),
  error: () => fire(PATTERNS.error),
};
