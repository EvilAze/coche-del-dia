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
import { createHistoryTrap } from "../lib/historyTrap";

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

// Variante para overlays con NIVELES INTERNOS (El Archivo: detalle → filtro →
// cerrar). Con useHistoryClose una sola "atrás" cerraría el overlay entero
// saltándose los niveles, y no vale con montar varias instancias: todas
// escuchan el mismo popstate, así que una pulsación las dispararía a la vez y
// colapsaría la cadena de golpe.
//
// Aquí hay SIEMPRE una única entrada fantasma viva. Cada "atrás" la consume y
// `onBack` decide qué hacer:
//   · devuelve true  → solo retrocedió un nivel; reponemos la entrada para
//                      seguir capturando la siguiente pulsación.
//   · devuelve false → el overlay se ha cerrado del todo; no reponemos nada y
//                      la "atrás" vuelve a ser navegación normal.
// Es el mismo contrato que la cadena de useEscape, y por eso conviene que
// ambas listas de condiciones se lean en el mismo orden.
// La contabilidad de entradas vive en lib/historyTrap.js (pura y testeada):
// aquí solo queda el cableado con React y el DOM.
export function useHistoryChain(active, onBack) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active) return;
    const trap = createHistoryTrap(window.history, () =>
      Boolean(onBackRef.current?.())
    );
    trap.arm();

    const onPop = () => trap.handlePop();
    window.addEventListener("popstate", onPop);

    return () => {
      // Quitamos el listener ANTES de desarmar: el history.back() de disarm()
      // dispara un popstate que no debe re-entrar en la cadena.
      window.removeEventListener("popstate", onPop);
      trap.disarm();
    };
  }, [active]);
}
