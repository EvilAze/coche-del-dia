// src/components/ModalShell.jsx
// Wrapper común para modales centrados con animación de entrada / salida.
//
//   - Backdrop: fade in/out.
//   - Panel: scale + fade + ligero slide-up.
//
// Implementado con transiciones CSS (sin framer-motion) para NO arrastrar esa
// librería al bundle inicial: ModalShell era su único consumidor "eager".
// El montaje/desmontaje diferido (para que la animación de SALIDA pueda
// completarse antes de quitar el nodo) se gestiona aquí con un pequeño estado.
//
// Requiere que el caller pase `open` y lo renderice siempre (incluso con
// open=false): este componente decide cuándo montar/desmontar.
//
// El click en el backdrop dispara onClose por defecto. Excepción:
// `dismissOnBackdrop={false}` para modales obligatorios (p.ej. NicknameModal).
//
// La tecla Escape NO se gestiona aquí — cada modal usa useEscape() por si
// necesita lógica condicional (cerrar sub-modales antes que el padre).

import { useEffect, useRef, useState } from "react";
import { useScrollLock } from "../hooks/useScrollLock";

// Duración de la transición (ms). El desmontaje espera un pelín más que la
// animación CSS para no cortar la salida. Mantener en sync con las clases
// `duration-200` de abajo.
const EXIT_MS = 220;

// La «atrás» de Android/navegador NO se gestiona aquí. Hubo un intento de
// hacerlo (pila propia de modales + pushState por apertura) y duplicaba lo que
// ya hay: App.jsx monta un `useHistoryClose` para todo el slot `activeModal`, y
// el Archivo su propia cadena `useHistoryChain`. La contabilidad de entradas es
// hoy una sola para toda la app (lib/historyTrap.js), así que una capa de más
// no descuadra el historial, pero sí cambia quién manda: apuntarse a la trampa
// es ponerse ENCIMA en la pila, y entonces la pulsación que el jugador cree
// dirigida al panel se la queda el chasis. Un overlay, un manejador: el que
// sabe qué niveles internos tiene.

export default function ModalShell({
  open,
  onClose,
  children,
  backdropClassName,
  panelClassName,
  dismissOnBackdrop = true,
  // Nombre accesible del diálogo (aria-label). Opcional: sin él, el lector de
  // pantalla anuncia "diálogo" igualmente. Recomendado pasarlo desde el caller.
  label,
}) {
  // Evita scroll chaining mientras el modal está abierto (contador interno,
  // así modales anidados funcionan bien).
  useScrollLock(open);

  // `render`: ¿está el nodo en el árbol? `visible`: ¿clases de estado visible?
  // Al abrir: montamos (render) y, tras un frame, activamos visible → entra.
  // Al cerrar: quitamos visible → sale, y desmontamos tras EXIT_MS.
  const [render, setRender] = useState(open);
  const [visible, setVisible] = useState(false);
  const exitTimer = useRef(null);
  const panelRef = useRef(null);
  // Elemento que tenía el foco al abrir (normalmente el botón que disparó el
  // modal). Se lo devolvemos al cerrar para no "perder" al usuario de teclado.
  const lastFocusedRef = useRef(null);

  useEffect(() => {
    if (open) {
      if (exitTimer.current) {
        clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
      setRender(true);
      // Doble rAF: garantiza que el navegador pinte el estado inicial (oculto)
      // antes de activar la transición a visible. Sin esto, el nodo nacería ya
      // en su estado final y no habría animación de entrada.
      let raf2;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        if (raf2) cancelAnimationFrame(raf2);
      };
    }
    // Cerrando: dispara la salida y desmonta al terminar.
    setVisible(false);
    exitTimer.current = setTimeout(() => {
      setRender(false);
      exitTimer.current = null;
    }, EXIT_MS);
    return () => {
      if (exitTimer.current) {
        clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
    };
  }, [open]);

  // Foco: al abrir llevamos el foco al diálogo (sin robarlo si un hijo ya lo
  // tomó, p.ej. un input con autofocus). Al cerrar lo devolvemos al disparador
  // para no "perder" al usuario de teclado en la página de fondo.
  useEffect(() => {
    if (!open) return;
    lastFocusedRef.current = document.activeElement;
    const id = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) {
        panel.focus();
      }
    });
    return () => {
      cancelAnimationFrame(id);
      const prev = lastFocusedRef.current;
      if (prev && typeof prev.focus === "function") prev.focus();
    };
  }, [open]);

  // Focus trap: Tab / Shift+Tab ciclan DENTRO del diálogo, sin escaparse a la
  // página de fondo. (Escape lo gestiona cada modal vía useEscape.)
  function handleKeyDown(e) {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panel.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusables.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!render) return null;

  return (
    <div
      className={`
        ${backdropClassName}
        transition-opacity duration-200 ease-out motion-reduce:transition-none
        ${visible ? "opacity-100" : "opacity-0"}
      `}
      onClick={dismissOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`
          ${panelClassName}
          outline-none
          transition-[opacity,transform] duration-200 ease-out
          motion-reduce:transition-none
          ${visible ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-2 scale-95"}
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
