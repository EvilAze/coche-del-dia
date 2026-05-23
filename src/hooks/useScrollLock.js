// src/hooks/useScrollLock.js
// Bloquea el scroll del <body> mientras hay al menos un modal abierto.
//
// Por qué hace falta:
//   En móvil, cuando un modal scrollea y el usuario llega al final del
//   contenido interno, el navegador propaga el gesto al body de fondo
//   ("scroll chaining"). Resultado: la página debajo del modal se mueve,
//   el chrome del navegador entra/sale del viewport y aparecen artefactos
//   visuales raros — sobre todo en iOS Safari. Bloquear el body mientras
//   hay modal abierto corta el problema de raíz.
//
// Contador en vez de boolean:
//   Hay modales anidados (ScoringHelpModal dentro de Garage, CarDetail
//   dentro de Garage, etc.). Si cerrar el sub-modal restaurase el scroll
//   mientras el padre sigue abierto, el bug volvería a aparecer. Con un
//   contador, el body solo se desbloquea cuando TODOS los modales han
//   cerrado.
//
// Compensación del scrollbar:
//   Al ocultar el overflow del body, en desktop desaparece la scrollbar y
//   el contenido salta lateralmente. Compensamos añadiendo padding-right
//   igual al ancho de la scrollbar (medido en runtime, no hard-coded).
//   En móvil la scrollbar suele ser 0 px y este cálculo es no-op.

import { useEffect } from "react";

// Estado a nivel de módulo: una sola "fuente de verdad" del bloqueo
// compartida por todos los useScrollLock activos en la app a la vez.
let lockCount = 0;
let snapshot = null;

function applyLock() {
  if (typeof document === "undefined") return;
  const body = document.body;
  const html = document.documentElement;

  // Guardamos los valores originales para restaurarlos al desbloquear.
  // Si otro código ya tocó overflow/paddingRight, no queremos pisar su
  // valor — al cerrar lo dejamos como lo encontramos.
  snapshot = {
    bodyOverflow: body.style.overflow,
    bodyPaddingRight: body.style.paddingRight,
    htmlOverflow: html.style.overflow,
  };

  const scrollbarWidth = window.innerWidth - html.clientWidth;

  body.style.overflow = "hidden";
  // También en <html>: algunos navegadores móviles ignoran overflow
  // hidden en body si <html> sigue siendo overflow-visible.
  html.style.overflow = "hidden";
  if (scrollbarWidth > 0) {
    body.style.paddingRight = `${scrollbarWidth}px`;
  }
}

function releaseLock() {
  if (typeof document === "undefined" || !snapshot) return;
  const body = document.body;
  const html = document.documentElement;
  body.style.overflow = snapshot.bodyOverflow;
  body.style.paddingRight = snapshot.bodyPaddingRight;
  html.style.overflow = snapshot.htmlOverflow;
  snapshot = null;
}

/**
 * Bloquea el scroll del body mientras `active` sea true. Acepta cambios
 * dinámicos: si pasas de true → false (o el componente se desmonta),
 * decrementa el contador. Si llega a 0, desbloquea.
 */
export function useScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined;

    lockCount += 1;
    if (lockCount === 1) applyLock();

    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) releaseLock();
    };
  }, [active]);
}
