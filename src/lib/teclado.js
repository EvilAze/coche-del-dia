// src/lib/teclado.js
// Todo lo que la app hace cuando sube el teclado del sistema: sellar el estado
// en <html> (`data-teclado="abierto"`), dejar que React se entere (suscripción,
// vía useTecladoAbierto) y el gesto de cerrarlo tocando el papel.
// Solo nativo; en web es no-op (allí la página SÍ scrollea, que es lo normal).
//
// POR QUÉ EXISTE. La app monta un shell fijo: `.app-pantalla` ocupa el alto de
// la pantalla y no scrollea (ver «EL PLIEGO SIN SCROLL» en index.css). Eso vale
// mientras el alto de la ventana sea el de la pantalla, y deja de serlo al abrir
// el teclado, porque Android redimensiona el WebView.
//
// La primera versión de esto SOLTABA el shell mientras se escribía: la app
// volvía al flujo normal, con su scroll, y el jugador tecleaba en una pantalla
// que se movía. Hoy el sello significa otra cosa — «cambia de composición», no
// «ríndete»: el pliego sigue siendo una sola pantalla y se recompone para el
// hueco que deja el teclado (ver «EL MODO ESCRITURA» en index.css). El shell no
// se suelta nunca durante la partida.
//
// LA SEÑAL ES EL FOCO, NO LA GEOMETRÍA NI UN PLUGIN. Esto empezó usando
// @capacitor/keyboard y la dependencia se retiró por dos motivos:
//
//   1. Era superficie nativa nueva —la única de esa release— y tenía que
//      quedar registrada por `cap sync` para funcionar. Un arranque de app que
//      depende de que un plugin esté bien registrado es un arranque más frágil,
//      y aquí no hacía falta ninguno: enfocar un campo de texto en un móvil ES
//      lo que abre el teclado. El foco es la CAUSA, no un síntoma que haya que
//      medir, así que llega antes que cualquier resize y no puede fallar por
//      config.
//   2. Medir el viewport tampoco servía como alternativa: con `adjustResize`
//      (el modo por defecto de Android) `innerHeight` y `visualViewport.height`
//      encogen A LA PAR, así que no hay proporción que comparar sin recordar un
//      alto base — y ese base caduca al girar el móvil. Es justo el enredo que
//      useEncajeEscenario ya documenta al congelar su alto de ventana.
//
// Y ese mismo `adjustResize` es lo que hace que el modo escritura no tenga que
// medir NADA: si Android encoge el WebView, el hueco sobre el teclado ES la
// ventana, así que un `100dvh` en el shell ya vale exactamente lo que se ve.
//
// Un teclado físico (Bluetooth) daría un falso positivo: se enfoca el campo sin
// que suba teclado. El coste es una composición más apretada de la necesaria
// durante un rato; ningún dato se pierde y el gesto de siempre la deshace.

import { Capacitor } from "@capacitor/core";

const ABIERTO = "abierto";

// Tipos de <input> que NO abren teclado: si el foco cae en uno, no hay por qué
// recomponer nada.
const SIN_TECLADO = new Set([
  "checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "image",
]);

// Margen antes de recomponer. El combo de marca/modelo mueve el foco entre el
// campo y su listbox, y sin esta espera el pliego se recompondría dos veces en
// el mismo gesto — un salto de maqueta mientras el jugador escribe. Si el foco
// aterriza en otro campo, el sellado sigue puesto.
const MARGEN_MS = 120;
let pendiente = 0;

// Estado + suscriptores. React no puede leer el atributo de <html> sin observar
// el DOM, así que la fuente de verdad vive aquí y useTecladoAbierto se suscribe.
let abierto = false;
const oyentes = new Set();

/** ¿Está el teclado del sistema arriba? (snapshot para useSyncExternalStore) */
export function tecladoAbierto() {
  return abierto;
}

/** Suscripción al cambio de estado. Devuelve la baja. */
export function suscribirTeclado(cb) {
  oyentes.add(cb);
  return () => oyentes.delete(cb);
}

function sellar(valor) {
  if (typeof document === "undefined") return;
  if (valor === abierto) return;
  abierto = valor;
  const el = document.documentElement;
  if (valor) el.dataset.teclado = ABIERTO;
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
    clearTimeout(pendiente);
    sellar(true);
  });

  document.addEventListener("focusout", (evento) => {
    if (!esCampoDeTexto(evento.target) || enUnModal(evento.target)) return;
    clearTimeout(pendiente);
    pendiente = setTimeout(() => {
      // Solo recomponemos si el foco NO ha ido a otro campo de texto.
      const activo = document.activeElement;
      if (!esCampoDeTexto(activo) || enUnModal(activo)) sellar(false);
    }, MARGEN_MS);
  });

  // Tocar el papel cierra el teclado. Es el gesto que espera cualquiera que
  // haya usado un móvil, y en el modo escritura es además la salida natural:
  // arriba solo queda papel en blanco y el recorte de la foto. Sin esto la
  // única salida es el gesto atrás del sistema, que en un juego se parece
  // demasiado a «salir de la partida».
  document.addEventListener("pointerdown", (evento) => {
    if (!abierto) return;
    if (evento.target?.closest?.(INTERACTIVO)) return;
    document.activeElement?.blur?.();
  });
}

/**
 * Sube el campo recién enfocado por encima del teclado, en táctil.
 *
 * Se calla en UN solo caso: un campo dentro del shell fijo de la app. Ahí no
 * hace falta —el modo escritura ya deja el cupón pegado al teclado— y encima
 * hace daño: desplazar un shell que por diseño no se mueve se ve como un salto
 * al enfocar (un contenedor sigue siendo desplazable por programa aunque su
 * overflow esté recortado).
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
