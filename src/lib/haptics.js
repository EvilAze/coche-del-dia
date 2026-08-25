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

// La consulta de `prefers-reduced-motion` vivía aquí, y era el ÚNICO sitio del
// repo que la hacía: los tres desplazamientos suaves de la app la ignoraban. Se
// ha mudado a lib/movimiento.js, que es ahora lo que sabe de esto en JS.
import { menosMovimiento } from "./movimiento";

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

function canVibrate() {
  return (
    typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
  );
}

// PESO de cada intención. No es intensidad de vibración (eso lo decide el
// patrón): es cuánto IMPORTA el mensaje, y sirve para resolver los empates de
// la ventana de abajo.
const PESOS = {
  selection: 1,
  impactLight: 2,
  impactMedium: 3,
  impactHeavy: 4,
  warning: 4,
  success: 5,
  error: 5,
};

// LA VENTANA DE COALESCENCIA. Aquí había un throttle de 30 ms con la regla
// "gana el primero", puesto porque dos `vibrate()` muy seguidas se solapan en
// Android y se pierden. El problema no es el throttle, es el criterio: el
// primero en llegar es casi siempre el MENOS importante.
//
// El caso real, y el que obligó a cambiarlo: el acuse de recibo del dedo
// (lib/tacto.js) suena en `pointerdown`, y la validación del cupón suena en
// `click` — veinte milisegundos después. Con "gana el primero", el tic de 8 ms
// de "te he leído el dedo" se comía el `warning` de "ese coche ya lo probaste",
// que es justo el que lleva información. El jugador sentía algo, sí, pero lo
// mismo tanto si el intento valía como si no.
//
// Ahora: dentro de la ventana solo pasa lo que pesa MÁS que lo último que sonó.
// Con eso el tic hace su trabajo (decir "sí, te he sentido") y se aparta en
// cuanto llega algo con contenido. Y sigue cumpliendo lo que el throttle venía
// a hacer: nunca salen dos vibraciones solapadas.
//
// 110 ms y no 30 porque el hueco que hay que cubrir es el de pointerdown→click
// (unos 20-60 ms en un dedo normal, más en uno lento), no el de dos llamadas
// consecutivas de código. Por debajo de ~100 ms dos pulsos no se perciben como
// dos de todas formas: se perciben como uno más largo y más barato, que es
// contra lo que avisa la cabecera de este módulo.
const VENTANA_MS = 110;
let ultimoInstante = 0;
let ultimoPeso = 0;

function debeSonar(peso) {
  const ahora = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (ahora - ultimoInstante < VENTANA_MS && peso <= ultimoPeso) return false;
  ultimoInstante = ahora;
  ultimoPeso = peso;
  return true;
}

function fire(nombre) {
  if (!canVibrate()) return;
  if (menosMovimiento()) return;
  if (!debeSonar(PESOS[nombre] ?? 1)) return;
  try {
    navigator.vibrate(PATTERNS[nombre]);
  } catch {
    // Algunos navegadores tiran si el patrón es inválido — silencioso.
  }
}

// API pública. Cada método nombra una *intención*, no un patrón concreto.
// Si en el futuro afinamos los números, los call sites no se enteran.
export const haptic = {
  selection: () => fire("selection"),
  impactLight: () => fire("impactLight"),
  impactMedium: () => fire("impactMedium"),
  impactHeavy: () => fire("impactHeavy"),
  success: () => fire("success"),
  warning: () => fire("warning"),
  error: () => fire("error"),
};
