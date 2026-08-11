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
  // Logro: el único tipo en ORO, porque es el único que celebra algo (la regla
  // de marca: menta/rojo = acción, oro = "esto vale algo"). Existe como TIPO y
  // no como emoji en el texto porque el notificador venía metiendo un 🏅 dentro
  // del string traducido — rompía la gramática de glifos del propio toast y
  // dejaba un emoji distinto en cada sistema operativo junto a un glifo
  // tipográfico. El mérito lo marca el canal, no la cadena.
  logro: { glifo: "text-gold", icon: "★" },
};

// CUÁNTO VIVE CADA AVISO, y por qué no puede ser un solo número.
//
// Todos duraban 2400 ms —ni una sola llamada del proyecto pasa `duration`—, y
// para los errores eso es poco tiempo del que no se recupera nadie: en este
// juego el error NO es decorativo, es donde se explican las REGLAS. «Ese año ya
// lo has intentado», «el año está fuera de la horquilla», «te falta la marca»
// son frases de 30-60 caracteres, y la guía de siempre (leer una línea corta
// pide del orden de 4-5 s) las deja fuera por bastante.
//
// Y hay un agravante de este cupón en concreto: el error llega ACOMPAÑADO del
// temblor del formulario, que está arriba, mientras el aviso sale abajo. El
// jugador mira primero lo que se ha movido; cuando baja la vista, el telegrama
// ya se ha ido. Se pierde justo la frase que evita repetir el fallo — y en una
// partida de cinco intentos, repetir el fallo es caro.
//
// El resto se queda como estaba: un «copiado» o un «guardado» se leen de un
// vistazo y estorban si se quedan. El logro sube un poco porque celebra algo y
// merece verse. `opts.duration` sigue mandando por encima de todo.
const DURACION = { error: 5200, logro: 4000 };
const DURACION_POR_DEFECTO = 2400;

function ToastItem({ toast, onDismiss }) {
  const { t } = useT();
  const style = TYPE_STYLES[toast.type] || TYPE_STYLES.info;
  // La sombra va por token (`--sombra-flota`, index.css) y no con el rgba que
  // tenía escrito a mano: era la tinta del DÍA incrustada, aplicada también en la
  // edición de noche. Ahora el aviso, el desplegable del cupón, el recorte de la
  // foto, el sumario y las portadas del Archivo despegan del papel con la MISMA
  // sombra, y cada tema pone la suya.
  return (
    <div
      // El ERROR se anuncia como `alert` (asertivo) y el resto como `status`
      // (cortés). No es un detalle de purista: `status` ESPERA a que el lector
      // termine lo que esté diciendo, y lo que suele estar diciendo justo
      // entonces es el propio formulario que acaba de cambiar — así que el aviso
      // se anunciaba tarde, o se perdía por el camino cuando su turno llegaba
      // después de que el telegrama ya se hubiera retirado solo.
      role={toast.type === "error" ? "alert" : "status"}
      className={`
        pointer-events-auto flex w-full max-w-sm items-center gap-3
        rounded-none border border-tinta bg-papel
        px-4 py-3 font-serif text-sm text-tinta
        shadow-[shadow:var(--sombra-flota)]
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
      const tipo = opts.type || "info";
      const toast = {
        id,
        msg,
        type: tipo,
        duration: opts.duration ?? DURACION[tipo] ?? DURACION_POR_DEFECTO,
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
            // SIN `aria-live` aquí: cada telegrama trae ya el suyo (role
            // status/alert, que son regiones vivas por definición), y una región
            // viva dentro de otra hace que algunos lectores anuncien el mismo
            // aviso dos veces. La politeness tiene que decidirse POR AVISO
            // —el error es asertivo y el resto no—, y eso desde el contenedor,
            // que es uno solo para todos, no se puede.
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
