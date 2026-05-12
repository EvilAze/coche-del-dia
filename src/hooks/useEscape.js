import { useEffect } from "react";

// Cierra el modal/overlay cuando se pulsa ESC, sólo si está activo.
export function useEscape(active, onClose) {
  useEffect(() => {
    if (!active) return;
    function handleKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [active, onClose]);
}
