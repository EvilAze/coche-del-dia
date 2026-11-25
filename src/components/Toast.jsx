import { createContext, useCallback, useContext } from "react";
import { Toaster, toast as sonner } from "sonner";
import { useT } from "../i18n";

const ToastContext = createContext({
  push: () => "",
  dismiss: () => {},
});

// Sistema Asfalto: el toast es un aviso compacto con filete, sombra del sistema
// y glifo tipográfico; el tipo lo marca el color del glifo (acierto en tinta,
// error en rojo, logro en oro), sin barras de color ni halos.
const TYPE_STYLES = {
  info: { glifo: "text-tinta-2", icon: "ℹ" },
  success: { glifo: "text-tinta", icon: "✓" },
  error: { glifo: "text-rojo", icon: "✕" },
  // Logro: el único tipo en ORO, porque es el único que celebra algo (la regla
  // de marca: rojo = atención/gastado, oro = "esto vale algo"). Existe como
  // TIPO y no como emoji en el texto para no mezclar pictogramas del SO con
  // nuestra tipografía. El mérito lo marca el canal, no la cadena.
  logro: { glifo: "text-gold", icon: "★" },
};

// CUÁNTO VIVE CADA AVISO, y por qué no puede ser un solo número.
//
// En este juego el error NO es decorativo, es donde se explican las REGLAS
// («ese año ya lo has intentado», «te falta la marca»), y además llega junto al
// temblor del cupón arriba: el jugador mira primero lo que se movió y baja la
// vista después. Con 5,2 s le da tiempo a leerlo; con Sonner, además, tocarlo o
// pasar el cursor pausa el temporizador automáticamente.
//
// Un «copiado» o «guardado» se lee de un vistazo y estorba si se queda; el
// logro sube un poco porque celebra algo y merece verse. `opts.duration` manda
// siempre por encima de todo.
const DURACION = { error: 5200, logro: 4000 };
const DURACION_POR_DEFECTO = 2400;

function ToastItem({ id, msg, type, action, onDismiss }) {
  const { t } = useT();
  const style = TYPE_STYLES[type] || TYPE_STYLES.info;

  return (
    <div
      // El ERROR se anuncia como `alert` (asertivo) y el resto como `status`
      // (cortés): `status` espera a que el lector termine de anunciar el cambio
      // del formulario y el aviso de error podría llegar tarde o perderse.
      role={type === "error" ? "alert" : "status"}
      className="cdd-toast pointer-events-auto flex w-full max-w-sm items-center gap-3"
    >
      <span
        className={`shrink-0 text-cuerpo font-bold ${style.glifo}`}
        aria-hidden="true"
      >
        {style.icon}
      </span>
      <span className="min-w-0 flex-1 break-words leading-snug">{msg}</span>
      {action && (
        <button
          type="button"
          onClick={() => {
            action.onClick?.();
            onDismiss(id);
          }}
          className="cdd-toast-accion"
        >
          {action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(id)}
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
  const dismiss = useCallback((id) => {
    sonner.dismiss(id);
  }, []);

  const push = useCallback(
    (msg, opts = {}) => {
      const tipo = opts.type || "info";
      const duration = opts.duration ?? DURACION[tipo] ?? DURACION_POR_DEFECTO;

      // `sonner.custom` delega el apilado con profundidad, las físicas de
      // entrada/salida, la pausa al interactuar y el gesto de deslizar para
      // descartar, pero pinta 100% nuestro componente con los tokens de Asfalto.
      return sonner.custom(
        (id) => (
          <ToastItem
            id={id}
            msg={msg}
            type={tipo}
            action={opts.action}
            onDismiss={dismiss}
          />
        ),
        {
          duration: duration > 0 ? duration : Infinity,
          dismissible: true,
        }
      );
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ push, dismiss }}>
      {children}
      {/* Sonner gestiona su propio portal y pila de avisos. `unstyled` quita
          cualquier color o radio ajeno al tema Día/Noche; la posición inferior
          respeta `--safe-area-inset-bottom` (regla 18h) desde `index.css`. */}
      <Toaster
        position="bottom-center"
        visibleToasts={3}
        gap={8}
        expand={false}
        swipeDirections={["down", "right", "left"]}
        className="cdd-toaster"
        toastOptions={{
          unstyled: true,
          className: "cdd-sonner-item",
        }}
      />
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
