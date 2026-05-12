import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const ToastContext = createContext({
  push: () => "",
  dismiss: () => {},
});

let nextId = 0;
function genId() {
  nextId += 1;
  return `t-${Date.now()}-${nextId}`;
}

const TYPE_STYLES = {
  info: {
    border: "border-white/15",
    bar: "bg-white/40",
    icon: "ℹ",
  },
  success: {
    border: "border-green-400/40",
    bar: "bg-green-400",
    icon: "✓",
  },
  error: {
    border: "border-red-400/40",
    bar: "bg-red-400",
    icon: "!",
  },
};

function ToastItem({ toast, onDismiss }) {
  const style = TYPE_STYLES[toast.type] || TYPE_STYLES.info;
  return (
    <div
      role="status"
      className={`
        pointer-events-auto flex w-full max-w-sm items-center gap-3
        rounded-xl border ${style.border} bg-bg-tertiary/95 backdrop-blur-md
        px-4 py-3 text-sm text-white shadow-2xl shadow-black/60
        animate-toast-in
      `}
    >
      <span
        className={`
          flex h-6 w-6 shrink-0 items-center justify-center
          rounded-full ${style.bar} text-[12px] font-bold text-black
        `}
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
            shrink-0 rounded-md px-2 py-1 text-xs font-semibold
            uppercase tracking-widest text-accent hover:bg-accent/10
          "
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Cerrar aviso"
        className="
          shrink-0 rounded-md p-1 text-muted transition
          hover:bg-white/10 hover:text-white
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
