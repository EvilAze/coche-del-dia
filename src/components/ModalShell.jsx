// src/components/ModalShell.jsx
// Wrapper común para modales centrados con animación de entrada / salida.
//
//   - Backdrop: fade in/out, 180 ms.
//   - Panel: scale + fade + ligero slide-up con spring (~250 ms).
//
// Requiere que el componente caller pase `open` como prop y siempre lo
// renderice (incluso con open=false). AnimatePresence se encarga del
// montaje/desmontaje real para que el exit-animation pueda completarse.
//
// El click en el backdrop dispara onClose por defecto. Excepción:
// `dismissOnBackdrop={false}` para modales de onboarding obligatorios
// (p.ej. NicknameModal) que no deben poder cerrarse sin acción del usuario.
//
// La gestión de tecla Escape NO va aquí — cada modal puede tener lógica
// condicional (p.ej. ESC cerrando sub-modales antes que el padre), así que
// se mantiene en useEscape() del propio componente.

import { AnimatePresence, motion } from "framer-motion";
import { useScrollLock } from "../hooks/useScrollLock";

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const panelVariants = {
  hidden: { opacity: 0, scale: 0.96, y: 8 },
  visible: { opacity: 1, scale: 1, y: 0 },
};

const backdropTransition = { duration: 0.18 };
const panelTransition = { type: "spring", stiffness: 380, damping: 30 };

export default function ModalShell({
  open,
  onClose,
  children,
  backdropClassName,
  panelClassName,
  dismissOnBackdrop = true,
}) {
  // Evita scroll chaining: cuando el modal está abierto, el body queda
  // bloqueado para que el gesto de scroll dentro del modal no propague
  // y mueva la página de fondo (artefactos visuales en móvil).
  // El hook usa un contador, así que modales anidados funcionan bien.
  useScrollLock(open);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          transition={backdropTransition}
          className={backdropClassName}
          onClick={dismissOnBackdrop ? onClose : undefined}
        >
          <motion.div
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={panelTransition}
            className={panelClassName}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
