// src/lib/texto.js
// Normalización de texto para buscar sin que estorben mayúsculas ni tildes:
// "Citroën" y "citroen" tienen que encontrarse igual, y "Škoda" con "skoda".
//
// Vivía dentro de Combo.jsx y sale aquí porque ahora hay DOS buscadores con la
// misma promesa —el combo de la web y la hoja de selección de la app— y dos
// copias de esto acabarían divergiendo justo en el caso raro (la marca con
// diéresis que un jugador escribe sin ella).
//
// REGLA 14 DE CLAUDE.md, y no es teórica: el rango de tildes combinantes va
// SIEMPRE escapado (`̀-ͯ`). Escrito con los caracteres de verdad, un
// re-guardado con la codificación equivocada lo convierte en un rango inválido
// y el módulo entero deja de parsearse — se lleva por delante el chunk.

const DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g");

/**
 * Minúsculas y sin tildes. Acepta null/undefined y devuelve "".
 * NFD separa cada letra de su tilde y el replace se lleva las tildes sueltas.
 */
export function normalizar(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(DIACRITICOS, "");
}
