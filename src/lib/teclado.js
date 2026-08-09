// src/lib/teclado.js
// Todo lo que la app hace cuando sube el teclado del sistema: sellar el estado
// en <html> (`data-teclado`), dejar que React se entere (useTecladoAbierto) y el
// gesto de cerrarlo tocando el papel.
// Solo nativo; en web es no-op (allí la página SÍ scrollea, que es lo normal).
//
// POR QUÉ EXISTE. La app monta un shell fijo: `.app-pantalla` ocupa el alto de
// la pantalla y no scrollea (ver «EL PLIEGO SIN SCROLL» en index.css). Eso vale
// mientras el alto de la ventana sea el de la pantalla, y deja de serlo al abrir
// el teclado, porque Android redimensiona el WebView. Entonces el pliego cambia
// de composición (ver «EL MODO ESCRITURA»): no se suelta, se recompone.
//
// TRES ESTADOS, y el del medio es el que hace que no dé un salto:
//
//   · sin atributo → pantalla completa, shell fijo.
//   · `data-teclado="abierto"` → modo escritura. Se sella cuando la ventana ha
//     encogido DE VERDAD.
//   · `data-teclado="suelto"` → red de seguridad: hay un campo enfocado pero la
//     ventana no ha encogido. Ningún selector cuelga de él a propósito: el
//     pliego vuelve al flujo normal, con su scroll, que es el comportamiento de
//     siempre. Cubre el WebView que no redimensiona (teclado en overlay) y el
//     teclado físico Bluetooth. Sin este estado, un shell fijo con el teclado
//     encima dejaría el cupón detrás del teclado y sin scroll con el que
//     llegar: la app se quedaría muda.
//
// LA SEÑAL ES LA GEOMETRÍA, Y ANTES ERA EL FOCO. Merece explicación porque es
// un cambio de opinión con motivo:
//
//   · El foco llega ~200ms ANTES de que Android redimensione. Recomponer ahí
//     significa DOS cambios visuales seguidos: primero la pantalla se recompone
//     contra la ventana entera, después la ventana encoge y todo vuelve a
//     moverse. Eso es exactamente lo que se ve como «pega un salto» en un móvil
//     de verdad (reportado en el S25 Ultra, 2026-08-09).
//   · Esperando al `resize`, la recomposición ocurre EN EL MISMO FRAME en que
//     la ventana encoge: un solo cambio, y encima sincronizado con el teclado
//     que está subiendo. Que es como se comporta cualquier app nativa.
//
// Y la objeción que en su día descartó medir —«innerHeight y visualViewport
// encogen a la par, no hay proporción que comparar sin un alto base que caduca
// al girar»— se resuelve sola aquí: el alto base se toma EN EL FOCO, que es el
// instante en el que sabemos con certeza que el teclado todavía no está. No hay
// que recordarlo entre sesiones ni corregirlo al rotar.
//
// Lo que sigue sin hacer falta es un plugin: `@capacitor/keyboard` se retiró
// porque era superficie nativa nueva que había que registrar con `cap sync`
// para que la app arrancara bien, y `window.resize` no necesita nada.

import { Capacitor } from "@capacitor/core";

const ABIERTO = "abierto";
const SUELTO = "suelto";

// Tipos de <input> que NO abren teclado: si el foco cae en uno, no hay por qué
// recomponer nada.
const SIN_TECLADO = new Set([
  "checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "image",
]);

// Cuánto tiene que encoger la ventana para que eso sea un teclado. El más bajo
// que se ve en un móvil ronda los 200px; 120 deja margen de sobra sin que lo
// dispare un cambio de barras del sistema.
const UMBRAL_PX = 120;

// Si en medio segundo desde el foco no ha llegado ningún resize, este WebView
// no redimensiona: soltamos el pliego y que scrollee. Medio segundo es más que
// la animación del teclado (~250ms) y no se nota, porque hasta que vence no ha
// cambiado nada en pantalla.
const ESPERA_GEOMETRIA_MS = 500;

// Margen antes de deshacer. El combo de marca/modelo mueve el foco entre el
// campo y su listbox, y sin esta espera el pliego se recompondría dos veces en
// el mismo gesto. Si el foco aterriza en otro campo, el sellado sigue puesto.
const MARGEN_MS = 120;

let estado = null;
let campoEnfocado = false;
let alturaSinTeclado = 0;
let pendienteCierre = 0;
let esperandoGeometria = 0;
const oyentes = new Set();

/** ¿Está la app en modo escritura? (snapshot para useSyncExternalStore) */
export function tecladoAbierto() {
  return estado === ABIERTO;
}

/** Suscripción al cambio de estado. Devuelve la baja. */
export function suscribirTeclado(cb) {
  oyentes.add(cb);
  return () => oyentes.delete(cb);
}

function sellar(valor) {
  if (typeof document === "undefined" || valor === estado) return;
  estado = valor;
  const el = document.documentElement;
  if (valor) el.dataset.teclado = valor;
  else delete el.dataset.teclado;
  oyentes.forEach((cb) => cb());
}

function esCampoDeTexto(el) {
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  const etiqueta = el.tagName.toUpperCase();
  if (etiqueta === "TEXTAREA") return true;
  if (etiqueta !== "INPUT") return false;
  return !SIN_TECLADO.has((el.type || "text").toLowerCase());
}

// Un campo DENTRO de un modal no recompone el pliego. El modal tapa la pantalla
// de juego entera (nick, borrar cuenta, login), así que recomponer lo que hay
// detrás no se ve mientras se escribe y sí se ve al cerrar, como un salto sin
// causa aparente. Todos los modales de la app declaran role="dialog".
function enUnModal(el) {
  return !!el?.closest?.('[role="dialog"]');
}

// Elementos que NO deben cerrar el teclado al tocarlos: los que ya hacen algo.
// Ojo con `[role="option"]`: el listbox del combo elige AL SOLTAR, y un blur en
// el pointerdown recompondría la pantalla por debajo del dedo — la opción se
// movería antes de recibir el toque y el jugador elegiría otra cosa.
const INTERACTIVO =
  'input, textarea, select, button, a, label, summary, [contenteditable], ' +
  '[role="option"], [role="listbox"], [role="dialog"]';

/**
 * Engancha los listeners. Llamar UNA vez al arrancar, dentro del bloque nativo
 * de index.jsx. Síncrona y sin dependencias nativas: no puede fallar de una
 * forma que impida el arranque de la app.
 */
export function installKeyboardWatcher() {
  if (!Capacitor.isNativePlatform()) return;
  if (typeof document === "undefined") return;

  // `focusin`/`focusout` y no `focus`/`blur`: estos dos no burbujean, así que
  // no se pueden escuchar en el documento y habría que engancharlos campo a
  // campo — incluidos los que monta el combo sobre la marcha.
  document.addEventListener("focusin", (evento) => {
    if (!esCampoDeTexto(evento.target) || enUnModal(evento.target)) return;
    clearTimeout(pendienteCierre);
    // El alto base se toma SOLO al entrar de fuera. Saltar de MARCA a MODELO
    // con el teclado ya arriba lo tomaría con la ventana encogida, y entonces
    // ninguna ventana volvería a parecer «encogida» nunca más.
    if (!campoEnfocado) alturaSinTeclado = window.innerHeight;
    campoEnfocado = true;
    if (estado === null) {
      clearTimeout(esperandoGeometria);
      esperandoGeometria = setTimeout(() => sellar(SUELTO), ESPERA_GEOMETRIA_MS);
    }
  });

  document.addEventListener("focusout", (evento) => {
    if (!esCampoDeTexto(evento.target) || enUnModal(evento.target)) return;
    clearTimeout(pendienteCierre);
    pendienteCierre = setTimeout(() => {
      const activo = document.activeElement;
      if (esCampoDeTexto(activo) && !enUnModal(activo)) return;
      campoEnfocado = false;
      clearTimeout(esperandoGeometria);
      sellar(null);
    }, MARGEN_MS);
  });

  // AQUÍ ESTÁ EL SINCRONISMO. El handler sella dentro del propio evento de
  // resize, así que el navegador hace UN layout y UN pintado con la ventana ya
  // encogida y la composición ya cambiada.
  window.addEventListener("resize", () => {
    if (!campoEnfocado) return;
    if (window.innerHeight <= alturaSinTeclado - UMBRAL_PX) {
      clearTimeout(esperandoGeometria);
      sellar(ABIERTO);
    } else if (estado === ABIERTO) {
      // La ventana ha vuelto a crecer con el campo aún enfocado: o se ha
      // cerrado el teclado a mano, o el móvil ha girado. En los dos casos la
      // referencia vieja ya no vale.
      alturaSinTeclado = window.innerHeight;
      sellar(null);
    }
  });

  // Tocar el papel cierra el teclado. Es el gesto que espera cualquiera que
  // haya usado un móvil, y en el modo escritura es además la salida natural:
  // alrededor del cupón solo queda papel en blanco y el recorte de la foto. Sin
  // esto la única salida es el gesto atrás del sistema, que en un juego se
  // parece demasiado a «salir de la partida».
  document.addEventListener("pointerdown", (evento) => {
    if (!estado) return;
    if (evento.target?.closest?.(INTERACTIVO)) return;
    document.activeElement?.blur?.();
  });
}

/**
 * Sube el campo recién enfocado por encima del teclado, en táctil.
 *
 * Se calla en UN solo caso: un campo dentro del shell fijo de la app. Ahí no
 * hace falta —el modo escritura ya deja el cupón arriba, con la lista cayendo
 * hacia el teclado— y encima hace daño: desplazar un shell que por diseño no se
 * mueve se ve como un salto al enfocar (un contenedor sigue siendo desplazable
 * por programa aunque su overflow esté recortado).
 *
 * La condición son LAS DOS COSAS, y ninguna sobra: `.app-pantalla` se pinta
 * también en web —la clase está siempre, quien la enciende es
 * `data-plataforma="app"`—, así que sin el `isNativePlatform` esto dejaría sin
 * auto-scroll a la web móvil; y sin el `closest`, la repesca dentro de la app
 * —que monta este mismo formulario y NO tiene shell fijo, sino una página que
 * se lee bajando— se quedaría escribiendo detrás del teclado.
 */
export function acercarCampoAlTeclado(el) {
  if (!el) return;
  if (Capacitor.isNativePlatform() && el.closest?.(".app-pantalla")) return;
  if (!window.matchMedia?.("(pointer: coarse)")?.matches) return;
  // 280ms: el teclado tarda en subir y el viewport en encoger; antes de eso el
  // navegador calcularía el destino contra la ventana todavía entera.
  window.setTimeout(() => {
    el.scrollIntoView({ block: "start", behavior: "smooth" });
  }, 280);
}
