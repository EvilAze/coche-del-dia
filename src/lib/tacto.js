// src/lib/tacto.js
// El acuse de recibo del dedo, en un solo sitio.
//
// POR QUÉ EXISTE
//   La app apaga el `-webkit-tap-highlight-color` (index.css, «EL TACTO DE LA
//   APP») porque el rectángulo azul de Android encima del papel es chrome de
//   otra aplicación asomando por una costura. Apagarlo estaba bien; lo que no
//   se hizo fue pagar la deuda que deja, porque ese resaltado ERA el acuse de
//   recibo del sistema.
//
//   El CSS pone la mitad visible (ver «EL ACUSE DE RECIBO DEL DEDO», al final
//   de index.css: el papel se hunde un píxel, o la tinta vira a rojo). Esto es
//   la otra mitad, la que se siente.
//
// POR QUÉ DELEGADO Y NO EN CADA `onClick`
//   Porque el reparto actual es exactamente el síntoma que se quiere quitar: la
//   pantalla de juego está cubierta (GuessForm, la hoja, la cabecera, el final)
//   y las pantallas de detrás no tienen NADA — el Archivo tiene 31 manejadores
//   de clic y cero hápticos, la clasificación 7 y cero, el perfil 10 y cero. Se
//   nota justo al cruzar la puerta: el juego responde al dedo y el resto de la
//   app, no. Añadirlo a mano en sesenta sitios lo arregla hoy y se vuelve a
//   desalinear en el primer componente nuevo, que es como llegó hasta aquí.
//
//   Un oyente en la raíz es exhaustivo por construcción: lo que sea pulsable lo
//   tiene, incluido lo que todavía no existe.
//
// LO QUE NO HACE
//   No sustituye a los hápticos con SIGNIFICADO —`success` al ganar, `warning`
//   en un intento repetido, `error` de red—. Eso no es "te he sentido el dedo",
//   es "esto es lo que ha pasado", y sigue viviendo donde se sabe la respuesta.
//   Los dos conviven sin pisarse gracias a la ventana por peso de haptics.js:
//   este tic pesa 1 y se aparta en cuanto llega cualquier otra cosa.

import { haptic } from "./haptics";

// Lo que cuenta como "pulsable". Nombra ROLES, no clases: una clase se queda
// obsoleta en cuanto alguien renombra un componente, y aquí lo que importa es
// que el navegador y el lector de pantalla ya coinciden en que esto se pulsa.
const PULSABLE = [
  "button",
  "a[href]",
  "summary",
  '[role="button"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="link"]',
].join(",");

let montado = false;

export function montarTacto() {
  if (montado) return;
  if (typeof document === "undefined") return;
  montado = true;

  document.addEventListener(
    "pointerdown",
    (ev) => {
      // SOLO EL DEDO. Con ratón no hay nada que confirmar —el cursor ya cambia
      // de forma y el hover ya respondió— y con lápiz tampoco. `pointerType`
      // puede venir vacío en WebViews viejos: ahí, mejor no vibrar que vibrar
      // en un escritorio.
      if (ev.pointerType !== "touch") return;

      const el = ev.target?.closest?.(PULSABLE);
      if (!el) return;

      // Lo que no se puede pulsar no acusa recibo: vibrar sobre un botón
      // apagado es prometer una acción que no va a ocurrir, y es peor que el
      // silencio porque el jugador vuelve a intentarlo.
      if (el.disabled || el.getAttribute("aria-disabled") === "true") return;

      // Salida de emergencia por si alguna pieza necesita el silencio (un
      // control que se pulsa muchas veces seguidas, por ejemplo). Ninguna la
      // usa hoy; existe para no tener que desmontar todo esto si aparece.
      if (el.closest("[data-sin-tacto]")) return;

      haptic.selection();
    },
    // `capture` para que llegue aunque un manejador de por medio pare la
    // propagación (la hoja del cupón lo hace con sus gestos), y `passive`
    // porque esto no cancela nada: un oyente no pasivo en `pointerdown` le
    // cuesta al navegador retrasar el scroll por si acaso.
    { capture: true, passive: true }
  );
}
