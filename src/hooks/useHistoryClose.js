// src/hooks/useHistoryClose.js
// Hace que el botón «atrás» del móvil/navegador CIERRE el overlay en vez de
// abandonar la web. Al abrir, empuja una entrada de historial "fantasma"; la
// primera pulsación de atrás cae en ella y dispara onClose (sin navegar). Si el
// overlay se cierra por la UI (X, scrim, Escape, enlace), consumimos esa entrada
// nosotros para no dejar un "atrás" que no hace nada.
//
// Por qué hacía falta: los modales a medida de la app no tocaban el historial,
// así que en Android/gestos la "atrás" natural para descartar el panel se
// llevaba al usuario fuera del sitio. Reutilizable por cualquier overlay.

import { useEffect, useRef } from "react";

export function useHistoryClose(active, onClose) {
  // Ref para no re-suscribir el listener en cada render aunque onClose cambie
  // de identidad (evita empujar/consumir entradas de más).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    // Si esta MISMA "atrás" fue la que cerró, no debemos volver a consumir la
    // entrada en la limpieza (ya la consumió el navegador al hacer pop).
    let poppedByBack = false;

    window.history.pushState({ cddOverlay: true }, "");
    const onPop = () => {
      poppedByBack = true;
      onCloseRef.current?.();
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      if (!poppedByBack) {
        // Cierre por UI: retira nuestra entrada fantasma. El popstate que esto
        // dispara ya no tiene listener, así que no re-entra en onClose.
        window.history.back();
      }
    };
  }, [active]);
}
