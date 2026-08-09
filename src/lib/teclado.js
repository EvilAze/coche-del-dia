// src/lib/teclado.js
// Lo que la app hace cuando sube el teclado del sistema. Hoy son dos cosas
// pequeñas, y que sean pequeñas es la noticia.
//
// LO QUE HABÍA AQUÍ. Este módulo llegó a tener tres estados, un umbral de
// píxeles, un temporizador de espera y un detector de resize, todo para que la
// pantalla de juego sobreviviera a un teclado abierto encima: se recomponía
// entera, retiraba la fotografía, anclaba el cupón y recolocaba el desplegable.
// Nada de eso existe ya. En la app el cupón no se teclea —los renglones abren
// una hoja de selección (ver SelectorHoja)— así que sobre la pantalla de juego
// el teclado NO APARECE, y todo el aparato que lo gestionaba sobra.
//
// QUEDA EL SELLO, como red de seguridad y por una razón concreta: el pliego
// monta un shell FIJO que no scrollea (ver «EL PLIEGO SIN SCROLL» en
// index.css). Si algún día vuelve a haber un campo de texto ahí dentro —o lo
// trae una pantalla que hoy no lo tiene— un teclado encima del shell fijo
// dejaría ese campo detrás del teclado y sin scroll con el que llegar: la app
// se quedaría muda. Con `data-teclado="abierto"` el pliego vuelve al flujo
// normal, con su scroll, que es el comportamiento de siempre y siempre es
// alcanzable.
//
// LOS CAMPOS DENTRO DE UN MODAL NO CUENTAN, y ahora es la vía normal, no el
// caso raro: el buscador de la hoja de selección vive en un `role="dialog"`.
// La hoja ya se ajusta sola al hueco que deja el teclado (su alto va en `dvh`),
// así que el pliego de detrás no tiene que enterarse de nada — y si se
// enterara, se recompondría por debajo de la hoja para nada y se vería el salto
// al cerrarla.

import { Capacitor } from "@capacitor/core";

const ABIERTO = "abierto";

// Tipos de <input> que NO abren teclado.
const SIN_TECLADO = new Set([
  "checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "image",
]);

// Margen antes de deshacer: mover el foco entre dos campos pasa por un instante
// sin foco, y sin esta espera el pliego se recompondría dos veces en el gesto.
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

function enUnDialogo(el) {
  return !!el?.closest?.('[role="dialog"]');
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
  // campo — incluidos los que se montan sobre la marcha.
  document.addEventListener("focusin", (evento) => {
    if (!esCampoDeTexto(evento.target) || enUnDialogo(evento.target)) return;
    clearTimeout(pendiente);
    sellar(true);
  });

  document.addEventListener("focusout", (evento) => {
    if (!esCampoDeTexto(evento.target) || enUnDialogo(evento.target)) return;
    clearTimeout(pendiente);
    pendiente = setTimeout(() => {
      const activo = document.activeElement;
      if (!esCampoDeTexto(activo) || enUnDialogo(activo)) sellar(false);
    }, MARGEN_MS);
  });
}

/**
 * Sube el campo recién enfocado por encima del teclado, en táctil.
 *
 * Se calla en UN solo caso: un campo dentro del shell fijo de la app, donde
 * desplazar movería algo que por diseño no se mueve y se ve como un salto (un
 * contenedor sigue siendo desplazable por programa aunque su overflow esté
 * recortado). Tras el cambio a selectores ahí ya no hay campos, pero la guarda
 * se queda: es la que hace que la regla sea «el shell fijo no se desplaza»
 * y no «esto ya no pasa».
 *
 * La condición son LAS DOS COSAS, y ninguna sobra: `.app-pantalla` se pinta
 * también en web —la clase está siempre, quien la enciende es
 * `data-plataforma="app"`—, así que sin el `isNativePlatform` esto dejaría sin
 * auto-scroll a la web móvil, que es donde SÍ se teclea.
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
