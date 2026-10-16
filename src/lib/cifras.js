// src/lib/cifras.js
// Las cifras de la ficha técnica tal como se pintan en «La ficha» del panel de
// resultado: cuáles hay, en qué orden y cómo se escriben.
//
// Llegan del servidor dentro del `reveal`, y solo al ganar: la política vive en
// api/_lib/cifras.js (columnas sin GRANT, condición de victoria dentro). Este
// módulo no decide nada de eso — recibe lo que haya y devuelve SOLO lo que
// exista. Un coche sin cifras no tiene bloque; uno con dos pinta dos, sin
// casillas vacías para las otras.

// El orden de cualquier ficha de fabricante: lo que da el motor (potencia y
// par) y lo que hace el coche con ello (0-100 y punta). `clave` es la del
// `reveal` (la misma que api/_lib/cifras.js; un test lo vigila) y `decimales`,
// los que se ESCRIBEN: el 0-100 siempre con uno («4,0 s», no «4 s»), como en
// las fichas.
//
// La unidad de potencia en inglés es «PS» y no «hp», a propósito: el dato está
// en CV (caballo métrico, el PS de las fichas europeas) y el hp anglosajón es
// un 1,4 % menor. Poner «510 hp» sería redondear a ojo en una pantalla que
// presume de precisión; convertirlo, inventarse una cifra que el fabricante no
// publicó.
export const ORDEN_CIFRAS = [
  { clave: "potenciaCv", decimales: 0, etiqueta: "fin.cifras.potencia", unidad: "fin.cifras.cv" },
  { clave: "parNm", decimales: 0, etiqueta: "fin.cifras.par", unidad: "fin.cifras.nm" },
  { clave: "aceleracion", decimales: 1, etiqueta: "fin.cifras.aceleracion", unidad: "fin.cifras.s" },
  { clave: "vmaxKmh", decimales: 0, etiqueta: "fin.cifras.vmax", unidad: "fin.cifras.kmh" },
];

/**
 * Las cifras que hay que pintar, en orden. Lo que no sea un número positivo
 * —null, ausente, NaN, un 0 que se coló— no se pinta: un «0 CV» no es un dato,
 * es un hueco disfrazado.
 *
 * @param {object|null|undefined} cifras  el `reveal.cifras` tal cual
 * @returns {Array<{clave, decimales, etiqueta, unidad, valor}>}
 */
export function cifrasVisibles(cifras) {
  if (!cifras || typeof cifras !== "object") return [];
  return ORDEN_CIFRAS.filter((c) => {
    const v = cifras[c.clave];
    return typeof v === "number" && Number.isFinite(v) && v > 0;
  }).map((c) => ({ ...c, valor: cifras[c.clave] }));
}

/**
 * Una cifra escrita como se escribe en el idioma de quien la lee: «3,9» en
 * español, «3.9» en inglés.
 *
 * @param {number} valor
 * @param {number} decimales
 * @param {string} locale  «es», «en», o un BCP-47 completo
 */
export function formatearCifra(valor, decimales, locale) {
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }).format(valor);
  } catch {
    // Un locale que Intl no conozca no puede dejar la ficha sin cifras.
    return decimales > 0 ? valor.toFixed(decimales) : String(Math.round(valor));
  }
}
