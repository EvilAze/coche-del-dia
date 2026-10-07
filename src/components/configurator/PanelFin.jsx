// src/components/configurator/PanelFin.jsx
// EL ARMAZÓN DEL PANEL FINAL, uno para la partida diaria (EndScreen) y otro
// para la Repesca… que eran el mismo objeto en DESIGN.md y dos copias en el
// código. La de la Repesca se había quedado atrás en todo lo que no se ve: sin
// foco al abrir, sin Escape, sin «atrás» que la cerrara y sin bloqueo del
// scroll de fondo (auditoría 7-oct). Aquí vive lo común —el diálogo, el velo,
// la tarjeta que scrollea, la ✕ y su franja— y cada panel pone su contenido.
//
// Comportamiento: el que tenía EndScreen, más dos cosas:
//   · Tab no se escapa de la tarjeta (lib/foco.js, como ModalShell).
//   · La ✕ gana una franja de fondo en cuanto la tarjeta se desplaza: sobre la
//     foto flota bien, pero al bajar tapaba títulos y botones (.con-banda).

import { useEffect, useRef, useState } from "react";
import { useScrollLock } from "../../hooks/useScrollLock";
import { useEscape } from "../../hooks/useEscape";
import { useHistoryClose } from "../../hooks/useHistoryClose";
import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { atraparTab } from "../../lib/foco";
import { Icon, I } from "./icons";

export default function PanelFin({ onClose, children }) {
  const { t } = useT();

  // Un modal a medida: Escape cierra, se bloquea el scroll del fondo y, sobre
  // todo, la «atrás» del móvil lo CIERRA en vez de sacar de la web. Solo se
  // monta cuando está visible, así que el «active» de los tres es constante.
  useScrollLock(true);
  useEscape(true, onClose);
  useHistoryClose(true, onClose);

  // El foco entra al panel al abrirlo, la otra mitad de lo que promete
  // `aria-modal`. En un rAF, como ModalShell: la tarjeta tiene animación de
  // entrada y aún se está montando. `preventScroll`: enfocarla no debe moverla
  // ni un píxel — el revelado del coche tiene que verse desde arriba.
  const cardRef = useRef(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => cardRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, []);

  const [conBanda, setConBanda] = useState(false);

  return (
    // `aria-modal="true"` promete que lo de fuera NO existe para un lector de
    // pantalla: por eso el panel lleva nombre y recibe el foco al abrirse.
    <div className="cdd-end" role="dialog" aria-modal="true" aria-label={t("cdd.endScreenAria")}>
      <div className="cdd-end-scrim" onClick={onClose} />
      <div
        className="cdd-end-card fin outline-none"
        ref={cardRef}
        tabIndex={-1}
        onKeyDown={(e) => atraparTab(e, cardRef.current)}
        onScroll={(e) => setConBanda(e.currentTarget.scrollTop > 24)}
      >
        {/* Cerrar SIEMPRE a la vista: barra sticky de alto 0 con la ✕ arriba a
            la izquierda (la derecha es de la chapa del veredicto). */}
        <div className={"cdd-end-topbar" + (conBanda ? " con-banda" : "")}>
          <button
            type="button"
            className="cdd-end-close"
            aria-label={t("cdd.volverPartida")}
            onClick={() => {
              haptic.impactLight();
              onClose?.();
            }}
          >
            <Icon d={I.x} size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
