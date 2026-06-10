// src/hooks/useModalState.js
// Gestión de los overlays globales de App.jsx: qué modal está activo y qué
// modales lazy se han montado ya al menos una vez.
//
// El mapa `mounted` existe porque los modales son React.lazy: solo queremos
// descargar su chunk en la primera apertura, pero una vez montados deben
// PERMANECER en el árbol para que la animación de salida de
// ModalShell/AnimatePresence pueda completarse al cerrarse.

import { useCallback, useState } from "react";

export function useModalState() {
  const [activeModal, setActiveModal] = useState(null);
  const [mounted, setMounted] = useState({});

  const mountModal = useCallback((key) => {
    setMounted((m) => (m[key] ? m : { ...m, [key]: true }));
  }, []);

  // Apertura estándar de un modal lazy: lo marca para montar y lo activa.
  // Para modales inline (login) basta con setActiveModal directamente.
  const openModal = useCallback(
    (key) => {
      mountModal(key);
      setActiveModal(key);
    },
    [mountModal]
  );

  const closeModal = useCallback(() => {
    setActiveModal(null);
  }, []);

  return {
    activeModal,
    setActiveModal,
    mounted,
    mountModal,
    openModal,
    closeModal,
  };
}
