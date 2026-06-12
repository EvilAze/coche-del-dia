// src/lib/fitText.js
// Cálculo PURO del tamaño de fuente para que un texto de UNA línea quepa en su
// contenedor (shrink-to-fit). Sin DOM: recibe medidas ya tomadas. Lo alimenta el
// hook useFitText con el scrollWidth/clientWidth reales del span de texto.
//
// O(1), sin bucle de "baja 0.5px y vuelve a medir": una regla de tres sobre el
// ancho natural del texto da el tamaño exacto al que ocuparía justo el ancho
// disponible. El factor de seguridad deja un pelo de holgura para que ningún
// glifo se recorte por redondeos sub-pixel.

const SAFETY = 0.97;

export function fitFontSize({ scrollWidth, clientWidth, base, min }) {
  // Primer paint antes del layout (medidas a 0): no encogemos.
  if (!(clientWidth > 0) || !(scrollWidth > 0)) return base;
  // Ya cabe al tamaño base.
  if (scrollWidth <= clientWidth) return base;
  // Tamaño al que el texto mediría justo el ancho disponible.
  const ideal = base * (clientWidth / scrollWidth) * SAFETY;
  // Acotado a [min, base] y redondeado a 0.1px hacia abajo (estable, nunca por
  // encima del ideal calculado).
  const clamped = Math.max(min, Math.min(base, ideal));
  return Math.floor(clamped * 10) / 10;
}
