import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";

const ToastContext = createContext({
  push: () => "",
  dismiss: () => {},
});

let nextId = 0;
function genId() {
  nextId += 1;
  return `t-${Date.now()}-${nextId}`;
}

// Sistema prensa: el toast es un TELEGRAMA — tira de papel con filete de
// tinta y glifo tipográfico; el tipo lo marca el color del glifo (acierto en
// tinta, error en rojo), sin barras de color ni sombras de neón. Colores
// concretos: los toasts se portalan a document.body, fuera de .prensa.
const TYPE_STYLES = {
  info: { glifo: "text-tinta-2", icon: "ℹ" },
  success: { glifo: "text-tinta", icon: "✓" },
  error: { glifo: "text-rojo", icon: "✕" },
};

function ToastItem({ toast, onDismiss }) {
  const { t } = useT();
  const style = TYPE_STYLES[toast.type] || TYPE_STYLES.info;
  return (
    <div
      role="status"
      className={`
        pointer-events-auto flex w-full max-w-sm items-center gap-3
        rounded-none border border-tinta bg-papel
        px-4 py-3 font-serif text-sm text-tinta
        shadow-[0_10px_22px_rgba(27,23,18,0.18)]
        animate-toast-in
      `}
    >
      <span
        className={`shrink-0 text-[15px] font-bold ${style.glifo}`}
        aria-hidden="true"
      >
        {style.icon}
      </span>
      <span className="min-w-0 flex-1 break-words leading-snug">{toast.msg}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action.onClick?.();
            onDismiss(toast.id);
          }}
          className="
            shrink-0 rounded-none px-2 py-1 text-xs font-semibold
            uppercase tracking-widest text-rojo hover:underline
          "
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={t("toast.closeAria")}
        className="
          shrink-0 rounded-none p-1 text-tinta-2 transition
          hover:text-rojo
        "
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (msg, opts = {}) => {
      const id = genId();
      const toast = {
        id,
        msg,
        type: opts.type || "info",
        duration: opts.duration ?? 2400,
        action: opts.action,
      };

      setToasts((current) => [...current.slice(-2), toast]);

      if (toast.duration > 0) {
        const timer = setTimeout(() => dismiss(id), toast.duration);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const portalTarget = typeof document !== "undefined" ? document.body : null;

  return (
    <ToastContext.Provider value={{ push, dismiss }}>
      {children}
      {portalTarget &&
        createPortal(
          <div
            aria-live="polite"
            className="
              pointer-events-none fixed inset-x-0 bottom-0 z-[200]
              flex flex-col items-center gap-2
              px-4 pb-[max(1rem,env(safe-area-inset-bottom))]
            "
          >
            {toasts.map((toast) => (
              <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
            ))}
          </div>,
          portalTarget
        )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
