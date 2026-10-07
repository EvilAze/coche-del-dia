// src/lib/foco.js
// EL TAB NO SE ESCAPA DE UN DIÁLOGO.
//
// Vivía dentro de ModalShell y era su única copia. Ahora la necesita también el
// Archivo, que no monta ModalShell (es un panel de framer-motion a pantalla
// completa con su arrastre lateral) y por eso dejaba salir el foco: con Tab se
// acababa en «Abrir menú», en la página de detrás, con el Archivo aún encima.
// `aria-modal` promete que lo de fuera no existe; esto es lo que lo cumple para
// quien navega con teclado.

const ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Manejador de keydown: Tab y Shift+Tab ciclan DENTRO de `panel`.
 * (Escape lo gestiona cada diálogo con useEscape.)
 * @param {KeyboardEvent} e
 * @param {HTMLElement|null} panel
 */
export function atraparTab(e, panel) {
  if (e.key !== "Tab" || !panel) return;
  const enfocables = panel.querySelectorAll(ENFOCABLES);
  if (enfocables.length === 0) {
    e.preventDefault();
    panel.focus();
    return;
  }
  const primero = enfocables[0];
  const ultimo = enfocables[enfocables.length - 1];
  const activo = document.activeElement;
  if (e.shiftKey && (activo === primero || activo === panel)) {
    e.preventDefault();
    ultimo.focus();
  } else if (!e.shiftKey && activo === ultimo) {
    e.preventDefault();
    primero.focus();
  }
}
