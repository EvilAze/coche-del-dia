// src/hooks/useHistoryClose.js
// Hace que el botón «atrás» del móvil/navegador CIERRE el overlay en vez de
// abandonar la web. Al abrir, el overlay se apunta a la trampa compartida; la
// primera pulsación de atrás cae en la entrada fantasma que esa trampa mantiene
// y dispara onClose (sin navegar). Al cerrarse por la UI (X, scrim, Escape,
// enlace), se da de baja y la trampa retira la entrada si no queda nadie.
//
// Por qué hacía falta: los modales a medida de la app no tocaban el historial,
// así que en Android/gestos la "atrás" natural para descartar el panel se
// llevaba al usuario fuera del sitio. Reutilizable por cualquier overlay.
//
// TODA la contabilidad —cuántas entradas hay vivas, quién manda cuando hay dos
// overlays abiertos y, sobre todo, el RELEVO de un overlay a otro— vive en
// lib/historyTrap.js, que es puro y testeado. Aquí solo queda el cableado con
// React: apuntarse mientras `active`, darse de baja en la limpieza.

import { useEffect, useRef } from "react";
import { relevoGlobal } from "../lib/historyTrap";

export function useHistoryClose(active, onClose) {
  // Ref para no re-suscribir el manejador en cada render aunque onClose cambie
  // de identidad (evita altas y bajas de más en la pila).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    // Overlay de un solo nivel: la «atrás» siempre lo cierra del todo, así que
    // el manejador devuelve false y la trampa no repone nada por él.
    return relevoGlobal().registrar(() => {
      onCloseRef.current?.();
      return false;
    });
  }, [active]);
}

// Variante para overlays con NIVELES INTERNOS (El Archivo: detalle → filtro →
// cerrar). Con useHistoryClose una sola "atrás" cerraría el overlay entero
// saltándose los niveles.
//
// Cada "atrás" consume la entrada fantasma y `onBack` decide qué hacer:
//   · devuelve true  → solo retrocedió un nivel; la trampa repone la entrada
//                      para seguir capturando la siguiente pulsación.
//   · devuelve false → el overlay se ha cerrado del todo.
// Es el mismo contrato que la cadena de useEscape, y por eso conviene que ambas
// listas de condiciones se lean en el mismo orden.
export function useHistoryChain(active, onBack) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active) return;
    return relevoGlobal().registrar(() => Boolean(onBackRef.current?.()));
  }, [active]);
}
