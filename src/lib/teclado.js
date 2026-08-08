// src/lib/teclado.js
// Sella en <html> si el teclado del sistema está abierto (`data-teclado`).
// Solo nativo; en web es no-op (allí la página SÍ scrollea, que es lo normal).
//
// POR QUÉ EXISTE. La app monta un shell fijo: `.app-pantalla` ocupa el alto de
// la pantalla y no scrollea (ver «EL PLIEGO SIN SCROLL» en index.css). Eso vale
// mientras el alto de la ventana sea el de la pantalla, y deja de serlo al abrir
// el teclado, porque Android redimensiona el WebView. Con `data-teclado="abierto"`
// el pliego vuelve al flujo normal mientras se escribe, y de paso reaparece el
// «recorte» flotante de PhotoPeek, que existe justo para ese momento.
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
// Un teclado físico (Bluetooth) daría un falso positivo: se enfoca el campo sin
// que suba teclado. El coste es nulo — el pliego permite scroll durante un rato
// y no se ve distinto.

import { Capacitor } from "@capacitor/core";

const ABIERTO = "abierto";

// Tipos de <input> que NO abren teclado: si el foco cae en uno, no hay por qué
// soltar el shell.
const SIN_TECLADO = new Set([
  "checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "image",
]);

// Margen antes de recomponer el shell. El combo de marca/modelo mueve el foco
// entre el campo y su listbox, y sin esta espera el pliego se recompondría y se
// volvería a soltar en el mismo gesto — un salto de maqueta mientras el jugador
// escribe. Si el foco aterriza en otro campo, el sellado sigue puesto.
const MARGEN_MS = 120;
let pendiente = 0;

function sellar(abierto) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (abierto) el.dataset.teclado = ABIERTO;
  else delete el.dataset.teclado;
}

function esCampoDeTexto(el) {
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  const etiqueta = el.tagName.toUpperCase();
  if (etiqueta === "TEXTAREA") return true;
  if (etiqueta !== "INPUT") return false;
  return !SIN_TECLADO.has((el.type || "text").toLowerCase());
}

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
    if (!esCampoDeTexto(evento.target)) return;
    clearTimeout(pendiente);
    sellar(true);
  });

  document.addEventListener("focusout", (evento) => {
    if (!esCampoDeTexto(evento.target)) return;
    clearTimeout(pendiente);
    pendiente = setTimeout(() => {
      // Solo recomponemos si el foco NO ha ido a otro campo de texto.
      if (!esCampoDeTexto(document.activeElement)) sellar(false);
    }, MARGEN_MS);
  });
}
