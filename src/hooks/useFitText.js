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

//
// También vale para un <input> (el cupón de la web), con dos matices:
//   · Se mide sin el RELLENO horizontal. En el span del historial es cero y no
//     cambia nada; en un campo son 20-40px que, metidos en la regla de tres,
//     dejaban el texto un pelo más grande de lo que cabe.
//   · `activo: false` devuelve el tamaño del CSS y no mide. El campo lo apaga
//     mientras tiene el foco: quien edita necesita la letra entera (16px, la que
//     no dispara el zoom de iOS al enfocar) y el texto ya se desplaza solo.
export function useFitText(value, { min = 10, activo = true } = {}) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      // Quitamos el override para medir al tamaño que dicta el CSS (= base).
      el.style.fontSize = "";
      if (!activo) return;
      const cs = getComputedStyle(el);
      const base = parseFloat(cs.fontSize) || 12.5;
      const relleno = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const next = fitFontSize({
        scrollWidth: el.scrollWidth - relleno,
        clientWidth: el.clientWidth - relleno,
        base,
        min,
      });
      // Solo fijamos inline si hay que encoger; si cabe, deja mandar al CSS.
      if (next < base) el.style.fontSize = next + "px";
    };

    measure();

    // El ancho lo manda el contenedor del texto (parentElement = .cdd-chip-main,
    // al 100% de la celda de grid). Observar su tamaño NO crea bucle de
    // ResizeObserver: encoger el font-size del span no ensancha al padre (su ancho
    // lo fija el grid del chip, no el contenido), solo cambia el texto.
    const parent = el.parentElement;
    if (typeof ResizeObserver === "undefined" || !parent) return;
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
    // 'value' debe ser el texto primitivo (string/número) del chip: es lo que
    // determina cuándo hay que volver a medir. No pasar objetos/arrays (su
    // referencia cambia en cada render y remediría de más).
  }, [value, min, activo]);

  return ref;
}
