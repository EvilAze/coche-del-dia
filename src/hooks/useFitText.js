// src/hooks/useFitText.js
// Auto-ajuste del tamaño de fuente para texto de UNA línea (shrink-to-fit).
// Devuelve un ref para el <span> de texto: mide su ancho natural (scrollWidth con
// white-space:nowrap) frente al disponible (clientWidth) y, si no cabe, le baja
// el tamaño con la fórmula pura de lib/fitText. El tamaño "base" se LEE del CSS
// (no se pasa), así el historial usa su 12.5px y la 'fila viva' su tamaño propio
// sin tocar el hook. Recalcula al cambiar el valor o el ancho del contenedor
// (ResizeObserver: rotación, resize, salto móvil↔desktop del grid).

import { useLayoutEffect, useRef } from "react";
import { fitFontSize } from "../lib/fitText";

export function useFitText(value, { min = 10 } = {}) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      // Quitamos el override para medir al tamaño que dicta el CSS (= base).
      el.style.fontSize = "";
      const base = parseFloat(getComputedStyle(el).fontSize) || 12.5;
      const next = fitFontSize({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        base,
        min,
      });
      // Solo fijamos inline si hay que encoger; si cabe, deja mandar al CSS.
      if (next < base) el.style.fontSize = next + "px";
    };

    measure();

    // El ancho lo manda el chip (padre del span). Observar su tamaño NO crea
    // bucle de ResizeObserver: cambiar el font-size del hijo no altera el tamaño
    // del chip (es celda de grid con ancho fijo + min-height), solo el texto.
    const parent = el.parentElement;
    if (typeof ResizeObserver === "undefined" || !parent) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [value, min]);

  return ref;
}
