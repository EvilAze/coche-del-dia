// src/components/Garage.jsx
// «EL ARCHIVO» — la colección de portadas del jugador.
//
// (El archivo y el endpoint conservan el nombre histórico `garage`; el
// producto se llama El Archivo desde el rediseño de colección. Renombrar los
// ficheros obligaría a tocar rutas lazy y analítica sin ganar nada.)
//
// IDEA RECTORA: cada coche ganado es una PORTADA numerada de la revista, y
// esto es su archivo de números atrasados. Todo lo demás se deriva de ahí.
//
// Estructura — UNA sola vista con filtro, no una jerarquía navegable:
//   · Sin filtro  → la vitrina: TUS portadas, lo último conseguido primero.
//                   Sin huecos: 300 casillas vacías comunican deuda, no
//                   colección.
//   · Con país    → la página del álbum de ese país: sus marcas, cada una
//                   con sus portadas Y sus huecos. Aquí los huecos SÍ suman,
//                   porque son contables ("me faltan 2 Ferrari") y por tanto
//                   motivan. Es la regla del álbum de cromos de toda la vida.
//   · Detalle     → la portada a tamaño grande que se VOLTEA para leer su
//                   dorso (ficha + cómo la conseguiste). Un modal es una
//                   ficha de producto; un cromo se le da la vuelta.
//
// El país dejó de ser un nivel de navegación (antes: países → marcas →
// coches, dos taps hasta ver un solo cromo) y pasó a ser un chip de filtro:
// se salta de país a país sin volver atrás.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { supabase } from "../supabaseClient";
import { useEscape } from "../hooks/useEscape";
import { useHistoryChain } from "../hooks/useHistoryClose";
import { useScrollLock } from "../hooks/useScrollLock";
import { useT, getCarDescription, getLocalizedCountry } from "../i18n";
import { useToast } from "./Toast";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";
import { PortadasArchivo } from "./Esqueleto";
import RepescaDrawAnimation from "./RepescaDrawAnimation";
import { track, plataforma } from "../lib/analytics";
import { captureClientError } from "../lib/sentry";
import { flagImagePath } from "../data/countries";
import { apiUrl } from "../lib/apiUrl";
import { countryTier, brandTier, collectorTier } from "../lib/collectionTier";
import { Icon, I } from "./configurator/icons";
import { logoMarca } from "../lib/logoMarca";
import {
  collectCovers,
  sortCovers,
  groupByBrand,
  meritsOf,
  stampsOf,
  pickNewCovers,
  issueLabel,
  formatWonAt,
  rarityTier,
  formatRarityPct,
} from "../lib/archive";
import { liveAngle, settleAngle, showsBack } from "../lib/flipAngle";

// Píxeles de indecisión antes de decidir si el gesto es un volteo o un scroll.
// Por debajo de esto no tocamos la carta: un tap con temblor no debe moverla.
const DRAG_SLOP_PX = 8;

// Arrastre de volteo: la carta SIGUE AL DEDO en tiempo real y solo al soltar
// decide si completa la vuelta o se recoloca. Antes era todo-o-nada (el swipe
// disparaba un giro fijo al final del gesto), que se siente como un botón
// escondido; seguir al dedo es lo que hace que la carta parezca un objeto
// físico que estás girando con la mano.
//
// La matemática (ángulo en vivo, umbral, qué cara mira) vive en
// lib/flipAngle.js; aquí solo está el cableado de eventos.
//
// Los listeners de move/up van en WINDOW, no en el nodo: si se soltara fuera
// de la carta —que con un arrastre largo pasa constantemente— el pointerup
// nunca llegaría y la carta se quedaría colgada a medio girar.
function useFlipDrag(angle, setAngle) {
  const startRef = useRef(null);
  const draggedRef = useRef(false);
  const [dx, setDx] = useState(null);

  // El ángulo que se pinta: el del dedo mientras se arrastra, el asentado si no.
  const width = startRef.current?.w || 1;
  const currentAngle = dx === null ? angle : liveAngle(angle, dx, width);

  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Un gesto cada vez: con dos dedos, el segundo pisaría el origen del
    // primero y la carta pegaría un salto.
    if (startRef.current) return;
    const w = e.currentTarget.getBoundingClientRect().width || 1;
    const start = { x: e.clientX, y: e.clientY, w, axis: null };
    startRef.current = start;
    draggedRef.current = false;

    const onMove = (ev) => {
      const s = startRef.current;
      if (!s) return;
      const mx = ev.clientX - s.x;
      const my = ev.clientY - s.y;
      if (!s.axis) {
        // Aún no sabemos qué gesto es. Esperamos a que se defina para no
        // robarle el scroll vertical al usuario.
        if (Math.abs(mx) < DRAG_SLOP_PX && Math.abs(my) < DRAG_SLOP_PX) return;
        s.axis = Math.abs(mx) > Math.abs(my) ? "x" : "y";
        if (s.axis === "y") {
          finish();
          return;
        }
        draggedRef.current = true;
      }
      setDx(mx);
    };

    const onUp = (ev) => {
      const s = startRef.current;
      if (s && s.axis === "x") {
        setAngle(settleAngle(angle, ev.clientX - s.x, s.w));
      }
      finish();
    };

    function finish() {
      startRef.current = null;
      setDx(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", finish);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", finish);
  }

  return {
    currentAngle,
    // ¿Está el dedo puesto? Mientras lo esté, la transición CSS se apaga: con
    // ella activa, la carta llegaría siempre medio segundo tarde respecto al
    // dedo, que es exactamente lo que hace que una interacción se sienta
    // barata.
    dragging: dx !== null,
    // Los botones lo consultan para no voltear DOS veces: al soltar un
    // arrastre que empezó y acabó sobre el botón, el navegador dispara además
    // un click sintético que desharía el giro recién hecho.
    consumeDrag() {
      const was = draggedRef.current;
      draggedRef.current = false;
      return was;
    },
    handlers: { onPointerDown },
  };
}

// Cambio de filtro: un cruce corto (fade + 10px). No es navegación jerárquica
// —no hay "adentro" ni "afuera"—, así que no lleva dirección: solo un relevo
// limpio entre dos secciones hermanas.
const swapVariants = {
  enter: { opacity: 0, x: 10 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -10 },
};

const swapTransition = {
  x: { type: "spring", stiffness: 340, damping: 34 },
  opacity: { duration: 0.16 },
};

// El logotipo de la marca: src/lib/logoMarca.js (lo comparte la hoja de
// selección de la app).
const brandLogoPath = logoMarca;

export default function Garage({ open, onClose, user, onOpenLogin }) {
  const { t } = useT();
  const toast = useToast();
  const [state, setState] = useState({
    loading: false,
    data: null,
    error: "",
  });
  // Filtro de país activo (null = vitrina completa). Sustituye a los antiguos
  // selectedCountry + selectedBrand: la marca ya no es un nivel, es una
  // sección dentro de la página del país.
  const [filter, setFilter] = useState(null);
  // Orden de la vitrina: "recent" (lo último conseguido primero) o "year".
  const [order, setOrder] = useState("recent");
  const [detailCar, setDetailCar] = useState(null);
  // Portadas ganadas desde la última visita → cinta "NUEVO". Se calcula una
  // vez al cargar los datos y se consume ahí mismo (ver lib/archive.js).
  const [newIds, setNewIds] = useState(() => new Set());
  // Modal de confirmación de repesca aleatoria: se abre tras pulsar el CTA
  // y antes de tocar el backend, para que el usuario revise las reglas
  // (una al día, mitad de puntos, no afecta a la racha).
  const [confirmRepesca, setConfirmRepesca] = useState(false);
  // Modal "¿Cómo funciona la repesca?" (link bajo el CTA).
  const [helpOpen, setHelpOpen] = useState(false);
  // Estado del POST a /api/repesca/start mientras se sortea un coche.
  const [repescaStarting, setRepescaStarting] = useState(false);
  // Overlay de barajado de cromos. Lleva un objeto { carId, veteran } o null:
  // cuando es no-null, se monta la animación a pantalla completa y arranca
  // su secuencia visual. El redirect a /repesca lo dispara confirmAndStartRepesca
  // cuando el POST y la animación (duración mínima visual) han terminado.
  const [drawAnim, setDrawAnim] = useState(null);
  // Duración mínima de la animación de sorteo. Si el POST termina antes,
  // esperamos hasta cumplir este tiempo para no truncar el efecto visual.
  const REPESCA_DRAW_MIN_MS = 2500;

  // Bloquea el scroll del body mientras El Archivo está abierto. No usa
  // ModalShell (es un motion.div directo a body), así que hay que llamar al
  // hook a mano. Sus sub-modales sí usan ModalShell y heredan el bloqueo; el
  // contador interno del hook impide que cerrar un sub-modal libere el scroll
  // mientras el archivo sigue abierto.
  useScrollLock(open);

  // ESC: cadena de más interno a más externo. Un nivel menos que antes
  // (marca y país eran dos escalones; ahora el filtro es uno solo).
  useEscape(open && helpOpen, () => setHelpOpen(false));
  useEscape(open && !helpOpen && confirmRepesca, () => {
    if (!repescaStarting) setConfirmRepesca(false);
  });
  useEscape(
    open && !helpOpen && !confirmRepesca && Boolean(detailCar),
    () => setDetailCar(null)
  );
  useEscape(
    open && !helpOpen && !confirmRepesca && !detailCar && Boolean(filter),
    () => setFilter(null)
  );
  useEscape(
    open && !helpOpen && !confirmRepesca && !detailCar && !filter,
    onClose
  );

  // «Atrás» de Android / gesto del navegador: MISMA cadena que el ESC, en el
  // mismo orden. Sin esto, la atrás dentro del archivo se salía de la app —
  // que en un panel a pantalla completa es justo el gesto natural para
  // descartar, así que el usuario lo pulsa por instinto y acaba fuera.
  // Devolver true = "sigo abierto, mantén la trampa"; false = cerrado del todo.
  function handleHistoryBack() {
    // Durante el sorteo hay un redirect en vuelo: no dejamos escapar a medias.
    if (drawAnim) return true;
    if (helpOpen) {
      setHelpOpen(false);
      return true;
    }
    if (confirmRepesca) {
      // Igual que el ESC: mientras el POST está en vuelo no se cancela.
      if (!repescaStarting) setConfirmRepesca(false);
      return true;
    }
    if (detailCar) {
      setDetailCar(null);
      return true;
    }
    if (filter) {
      setFilter(null);
      return true;
    }
    onClose();
    return false;
  }

  useHistoryChain(open, handleHistoryBack);

  // Reset interno al cerrar.
  useEffect(() => {
    if (!open) {
      setFilter(null);
      setDetailCar(null);
      setConfirmRepesca(false);
      setHelpOpen(false);
    }
  }, [open]);

  // Instrumentación: una vez por apertura (logueado o no — el anónimo rebota
  // al login, pero su apertura ES interés por la colección y queremos medirlo).
  const trackedOpenRef = useRef(false);
  useEffect(() => {
    if (open && !trackedOpenRef.current) {
      trackedOpenRef.current = true;
      track("garage_open", { auth: user ? "user" : "anon" });
    } else if (!open) {
      trackedOpenRef.current = false;
    }
  }, [open, user]);

  // Reintento manual del fetch. Es un contador y no una función suelta a
  // propósito: `t` cambia de identidad en cada render, así que una `useCallback`
  // con la carga dentro haría refrescar el efecto sin parar. Subir el número es
  // inofensivo y dice exactamente lo que pasa.
  const [reintento, setReintento] = useState(0);

  // Fetch al abrir, solo logueado.
  useEffect(() => {
    if (!open || !user) return;

    setState({ loading: true, data: null, error: "" });

    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) {
          // Marcado, no identificado por su texto: el `catch` de abajo decide
          // qué se le enseña al jugador, y para eso necesita distinguir el caso
          // sin leer mensajes.
          const e = new Error("sin sesión");
          e.sinSesion = true;
          throw e;
        }

        const res = await fetch("/api/garage", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);

        setState({ loading: false, data: body, error: "" });
        // "¿Qué hay nuevo desde la última vez?" es el motivo por el que se
        // vuelve a un archivo. Se resuelve aquí, contra localStorage, en
        // cuanto sabemos qué portadas tiene el usuario.
        setNewIds(pickNewCovers(collectCovers(body.countries).map((c) => c.id)));
      } catch (err) {
        console.error("[Garage] fetch:", err);
        // EL MENSAJE TÉCNICO SE QUEDA EN LA CONSOLA. Aquí se pintaba
        // `err.message` tal cual, y ese mensaje viene de tres sitios que NO
        // están escritos para leerse: un `HTTP 500`, el `error` crudo que
        // devuelva el backend, o el texto del navegador cuando la red falla
        // («Failed to fetch»), que además llega en inglés pase lo que pase.
        // Cualquiera de los tres aparecía en mitad del Archivo, compuesto en
        // monoespaciada, con toda la pinta de una traza que se ha escapado.
        // El jugador no puede hacer nada con eso; quien depura ya lo tiene
        // arriba, en el console.error, y con el objeto entero.
        setState({
          loading: false,
          data: null,
          error: err?.sinSesion ? t("garage.errorNoSession") : t("garage.errorLoad"),
        });
      }
    })();
  }, [open, user, reintento]);

  // País activo del filtro (null = vitrina completa).
  const currentCountry =
    filter && state.data
      ? state.data.countries.find((c) => c.pais === filter) || null
      : null;

  // Todas las portadas conseguidas, ya ordenadas. Memoizado: aplanar el
  // catálogo entero en cada render (incluidos los del detalle) sería tirar
  // trabajo a la basura.
  const covers = useMemo(
    () => sortCovers(collectCovers(state.data?.countries), order),
    [state.data, order]
  );

  // Tamaño de la pool de repesca: cuántos coches ya fueron daily y el
  // usuario aún no los ha ganado. Lo calcula el servidor en /api/garage
  // (`repescaPoolSize`) — antes lo derivábamos en cliente con `wasDaily`
  // por-coche, pero esa señal permitía un cheat pasivo (filtrar locked +
  // !wasDaily revelaba candidatos a coche-del-día). Ahora solo recibimos
  // el agregado. El servidor también es quien elige el coche concreto en
  // /api/repesca/start (CSPRNG), así que el cliente nunca necesita los ids.
  const repescaPoolSize = state.data?.repescaPoolSize ?? 0;

  // La rueda de órdenes de la tecla de la cabecera.
  const ordenes = ["recent", "year", ...((state.data?.rarityCollectors || 0) > 0 ? ["rarity"] : [])];
  const etiquetaOrden = t(
    order === "year" ? "garage.sortYear" : order === "rarity" ? "garage.sortRarity" : "garage.sortRecent"
  );
  function siguienteOrden() {
    setOrder(ordenes[(ordenes.indexOf(order) + 1) % ordenes.length]);
  }

  // Al cambiar de sección, el scroll vuelve arriba: si no, entras a Italia
  // y apareces a media página por donde estabas en la vitrina.
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [filter]);

  // Click en el CTA "Números atrasados". Hace los pre-checks rápidos antes
  // de abrir el modal de confirmación — no merece la pena enseñar reglas si
  // el usuario no tiene nada que repescar.
  //   1. Si ya hay una repesca activa hoy → reanuda directamente (sin
  //      mostrar reglas otra vez, ya las aceptó cuando arrancó).
  //   2. Si no hay coches pendientes → toast de enhorabuena.
  //   3. Si ya consumió la repesca de hoy → toast informativo.
  //   4. En cualquier otro caso → abrir modal con las condiciones.
  function handleRandomRepesca() {
    if (repescaStarting) return;

    if (state.data?.repescaActiveCarId) {
      window.location.href = `/repesca?id=${encodeURIComponent(
        state.data.repescaActiveCarId
      )}`;
      return;
    }

    if (repescaPoolSize === 0) {
      toast.push(t("garage.toastAllGuessed"), {
        type: "success",
      });
      return;
    }

    if (!state.data?.repescaAvailable) {
      toast.push(t("garage.toastRepescaConsumed"), { type: "info" });
      return;
    }

    setConfirmRepesca(true);
  }

  // El usuario acepta la repesca tras leer las condiciones. El SERVIDOR
  // elige el coche al azar (server-side CSPRNG); el cliente NO participa
  // en la elección. Lanzamos la animación de barajado con tema neutro
  // mientras viaja el POST, y cuando el server responde:
  //   - Si éxito → actualizamos el tema (veteran/normal) reactivamente,
  //     dejamos terminar la animación y redirigimos al pseudo carId que
  //     devuelve el server.
  //   - Si error → toast, abortamos animación, volvemos al estado base.
  //
  // Anti-cheat: antes esta función elegía el coche en cliente con
  // Math.random(). Como el cliente conoce metadatos del pool (país,
  // marca, veteran flag) podía sesgar la "aleatoriedad" hacia coches
  // más fáciles. Ahora la decisión es del server y este vector queda
  // cerrado. La pool local solo se usa para la guarda defensiva.
  async function confirmAndStartRepesca() {
    if (repescaStarting) return;
    if (repescaPoolSize === 0) {
      // Defensivo: la pool pudo cambiar entre apertura y aceptación.
      setConfirmRepesca(false);
      return;
    }

    setRepescaStarting(true);
    setConfirmRepesca(false);
    // Animación arranca con tema neutro (carId null, veteran false). El
    // prop `veteran` solo lo lee RepescaDrawAnimation en la fase final
    // del flip (~2.1s), así que actualizarlo cuando responda el POST
    // (típicamente <500ms) llega a tiempo de tematizar la carta hero.
    setDrawAnim({ carId: null, veteran: false });

    const minDelay = new Promise((r) => setTimeout(r, REPESCA_DRAW_MIN_MS));

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error(t("garage.errorNoSession"));

      // POST sin carId: indica al server "elige tú". El server devuelve
      // el pseudoCarId resultante (o el activo si ya había uno hoy, por
      // idempotencia).
      const postPromise = fetch("/api/repesca/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });

      // Esperamos SOLO al POST (no al minDelay todavía): así tenemos el
      // carId en cuanto el server responde (~300-600ms), no a los 2500ms.
      // Eso nos deja ~2s del barajeo para precargar la imagen del coche.
      const res = await postPromise;
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
      }
      const serverPickedId = body?.carId;
      if (!serverPickedId) {
        throw new Error("Server did not return a carId");
      }
      // Aplicamos el modo real a la animación (puede tematizar la carta
      // hero en su fase de flip si llegamos a tiempo).
      const serverVeteran = body?.mode === "veteran";
      setDrawAnim({ carId: serverPickedId, veteran: serverVeteran });
      track("repesca_start", { mode: serverVeteran ? "veteran" : "normal" });

      // PRELOAD de la imagen DURANTE el barajeo (fire-and-forget). Pedimos
      // la MISMA url que pedirá /repesca al montar (phase=playing). Esto:
      //   - Calienta sharp en el server (mata el cold start de ~2-3s).
      //   - Puebla la cache privada del navegador. Como /repesca es una
      //     navegación completa, el preload solo "viaja" gracias a que
      //     repesca/image es ahora cacheable (private, max-age=300): el
      //     blob queda en la cache HTTP y /repesca lo reusa al instante.
      // Consumimos .blob() para que la respuesta se descargue entera y el
      // navegador la guarde (si solo leyéramos headers, podría no cachear).
      const preload = (async () => {
        try {
          const r = await fetch(
            `/api/repesca/image?carId=${encodeURIComponent(serverPickedId)}&phase=playing`,
            { headers: { Authorization: `Bearer ${session.access_token}` } }
          );
          if (r.ok) await r.blob();
        } catch {
          // El preload nunca debe romper el flujo de la repesca.
        }
      })();

      // Navegamos cuando se cumplan AMBAS: (1) el tiempo mínimo de animación
      // (para no truncar el barajeo) y (2) que la imagen esté ya en la cache
      // del navegador. Así, al acabar "eligiendo coche", /repesca la pinta al
      // instante en vez de empezar a cargarla entonces. Tope de seguridad para
      // no colgar el flujo si el server se atasca (sharp en frío).
      await minDelay;
      await Promise.race([
        preload,
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ]);
      window.location.href = `/repesca?id=${encodeURIComponent(serverPickedId)}`;
    } catch (err) {
      console.error("[Garage] random repesca:", err);
      // El sorteo es el punto donde el jugador puede perder su repesca del día
      // sin llegar a jugarla, así que su fallo no puede quedarse en la consola.
      // Una por jugador y día: no hay riesgo de inundar el free tier.
      captureClientError(err, { flujo: "repescaSorteo", plataforma: plataforma() });
      toast.push(err?.message || t("garage.errorRepescaFailed"), {
        type: "error",
      });
      setRepescaStarting(false);
      setDrawAnim(null);
    }
  }

  // Swipe-from-edge para retroceder (estilo iOS):
  //   - El motion.div del panel acepta drag horizontal, pero `dragListener`
  //     está desactivado: el drag SOLO se inicia desde el edge handle,
  //     evitando interferir con scroll vertical, taps en cards o clicks en
  //     el header.
  //   - Threshold: 80 px de offset o 500 px/s de velocidad. El segundo es
  //     un "fling" rápido — confirma intención aunque la distancia sea corta.
  const dragControls = useDragControls();

  function handleSwipeEnd(_event, info) {
    const triggered = info.offset.x > 80 || info.velocity.x > 500;
    if (!triggered) return;
    // Mismo criterio que la cadena de ESC: si hay filtro, el swipe lo quita;
    // si ya estamos en la vitrina, cierra el archivo.
    if (filter) setFilter(null);
    else onClose();
  }

  return (
    // AnimatePresence externo: el backdrop hace fade in/out (200 ms) y el
    // panel un slide-up con fade y un pizco de scale (~280 ms con spring).
    <AnimatePresence>
      {open && (
        <motion.div
          key="garage-backdrop"
          className="scrim-flat fixed inset-0 z-[85] flex items-stretch justify-center"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            key="garage-panel"
            className="
              arch-panel relative flex w-full max-w-md flex-col overflow-hidden
            "
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            // Drag horizontal armado pero NO autostart: el edge handle de
            // abajo es quien dispara dragControls.start(). Así el resto del
            // panel sigue siendo scrollable / clickable normal.
            // dragSnapToOrigin: tras soltar, el panel vuelve a x=0 SIEMPRE.
            drag="x"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ left: 0, right: 200 }}
            dragElastic={0.15}
            dragSnapToOrigin
            onDragEnd={handleSwipeEnd}
          >
            {/*
              Edge handle invisible. Cubre los 16 px más a la izquierda del
              panel (coincide con el padding-x del body, por eso no solapa
              con cards ni CloseButton). touchAction: pan-y permite que el
              scroll vertical nativo siga funcionando dentro de la zona.
            */}
            <div
              aria-hidden="true"
              onPointerDown={(e) => dragControls.start(e)}
              className="absolute inset-y-0 left-0 z-30 w-4"
              style={{ touchAction: "pan-y" }}
            />

            {/* La cabecera: el nombre de la sección en grande, como el de una
                pantalla, el orden de la vitrina y cerrar. `safe-area-top` le
                suma el inset de la barra de estado: este panel va a pantalla
                completa y sin eso el titular se dibuja bajo el reloj del
                sistema. El aire propio viaja en la variable y no en un `pt-*`,
                porque la clase pisaría la utilidad (ver index.css). */}
            <div className="arch-cab safe-area-top" style={{ "--safe-area-extra-top": "0.5rem" }}>
              <h2 className="clas-titulo">{t("prensa.garaje")}</h2>
              {/* El orden, como UNA tecla que rota entre los disponibles: tres
                  palabras sueltas en una fila aparte eran una línea entera para
                  algo que se toca una vez. «Rareza» solo entra en la rueda
                  cuando el servidor publica el dato — un orden que no ordena
                  nada es peor que no ofrecerlo. Solo en la vitrina: la página
                  de un país va por marcas. */}
              {user && state.data && !currentCountry && covers.length > 1 && (
                <button
                  type="button"
                  className="arch-orden"
                  onClick={siguienteOrden}
                  aria-label={`${t("garage.sortAria")}: ${etiquetaOrden}`}
                >
                  {etiquetaOrden}
                  <Icon d={I.chevD} size={15} />
                </button>
              )}
              <CloseButton onClick={onClose} />
            </div>

            {/* Cuerpo */}
            {!user ? (
              <AuthWall
                onLogin={() => {
                  onClose();
                  onOpenLogin?.("garage");
                }}
              />
            ) : state.loading ? (
              /* LA VITRINA ANTES DE QUE LLEGUE. Aquí había una línea de texto
                 centrada («Abriendo el archivo…») con el `animate-pulse` de
                 Tailwind — el mismo gris parpadeante de tutorial que index.css
                 ya se molestó en echar de la portada por ser «el primer segundo
                 de la primera visita». Ahora la espera tiene la forma de lo que
                 se espera: portadas sin imprimir, con su filete, su cabecera de
                 kiosco y su hueco de foto en 4:3, respirando en papel. */
              <div className="safe-area-bottom flex-1 overflow-y-auto overscroll-contain">
                <PortadasArchivo n={6} texto={t("garage.loading")} />
              </div>
            ) : state.error ? (
              <CenterMessage
                text={state.error}
                tone="error"
                onRetry={() => setReintento((n) => n + 1)}
              />
            ) : !state.data || state.data.countries.length === 0 ? (
              <CenterMessage text={t("garage.emptyCatalog")} />
            ) : (
              <div
                ref={scrollRef}
                className="safe-area-bottom flex-1 overflow-y-auto overscroll-contain"
              >
                {/* El masthead y los números atrasados solo viven en la
                    vitrina: dentro de un país estorban, porque ahí la
                    cabecera es la del propio país. */}
                {!currentCountry && (
                  <>
                    <Masthead
                      total={state.data.totalUnlocked}
                      catalog={state.data.totalCatalog || 0}
                    />
                    <BackIssuesBand
                      poolSize={repescaPoolSize}
                      available={!!state.data?.repescaAvailable}
                      hasActive={!!state.data?.repescaActiveCarId}
                      starting={repescaStarting}
                      onClick={handleRandomRepesca}
                      onOpenHelp={() => setHelpOpen(true)}
                    />
                  </>
                )}

                <FilterStrip
                  countries={state.data.countries}
                  total={state.data.totalUnlocked}
                  active={filter}
                  onSelect={setFilter}
                />

                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={filter || "__all__"}
                    variants={swapVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={swapTransition}
                  >
                    {currentCountry ? (
                      <CountryPage
                        country={currentCountry}
                        newIds={newIds}
                        onSelectCar={setDetailCar}
                      />
                    ) : (
                      <Showcase
                        covers={covers}
                        newIds={newIds}
                        order={order}
                        onSelectCar={setDetailCar}
                      />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            )}
          </motion.div>

          {/*
            Los sub-modales reciben siempre `open` (boolean) además de su data,
            y permanecen montados aunque open=false: así ModalShell puede
            animar el exit antes de desmontarlos.
          */}
          <CoverDetail
            open={Boolean(detailCar)}
            car={detailCar}
            collectors={state.data?.rarityCollectors || 0}
            onClose={() => setDetailCar(null)}
            onStartRepesca={handleRandomRepesca}
          />

          <RandomRepescaConfirm
            open={confirmRepesca}
            poolSize={repescaPoolSize}
            starting={repescaStarting}
            onCancel={() => {
              if (repescaStarting) return;
              setConfirmRepesca(false);
            }}
            onAccept={confirmAndStartRepesca}
          />

          <RepescaHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
        </motion.div>
      )}

      {/* Overlay de barajado de cromos: vive FUERA del motion.div del panel
          para que cubra toda la pantalla (z-[120]) y no quede recortado por
          el max-w-md. Solo se monta cuando el usuario ha aceptado el sorteo
          y se desmonta cuando hay redirect (o si el POST falla). */}
      {drawAnim && (
        <RepescaDrawAnimation
          veteran={drawAnim.veteran}
          pendientes={repescaPoolSize}
        />
      )}
    </AnimatePresence>
  );
}

// ============================================================================
// La tarjeta de la colección
// ============================================================================
//
// Lo que TIENES en grande («86 de 247 portadas»), la barra del catálogo y,
// debajo, el rango de coleccionista con el siguiente a la vista. La prensa
// había retirado la barra global porque sobre un catálogo enorme vivía casi
// vacía; con el catálogo actual (unos centenares) se llena a un ritmo que se
// nota, y el diseño de «Asfalto» la quiere ahí: es lo que da sentido al número.

function Masthead({ total, catalog }) {
  const { t, tn, locale } = useT();
  const tier = collectorTier(total);
  const tierLabel = tier.tier ? tier.label?.[locale] || tier.label?.es : null;
  const nextLabel = tier.next ? tier.next.label?.[locale] || tier.next.label?.es : null;
  const pct = catalog > 0 ? Math.min(100, (total / catalog) * 100) : 0;

  return (
    <section className="arch-resumen" aria-label={t("garage.mastheadKicker")}>
      <p className="arch-resumen-cifra">
        <b>{total}</b>
        <span>{catalog > 0 ? tn("garage.deCatalogo", catalog) : tn("garage.covers", total)}</span>
      </p>
      {catalog > 0 && (
        <span className="arch-barra" aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </span>
      )}
      <div className="arch-resumen-pie">
        <span className={"arch-rango" + (tier.tier ? ` tier-${tier.tier}` : "")}>
          {tier.tier && <TierMedal tier={tier.tier} size={15} />}
          {tierLabel ? t("garage.rango", { tier: tierLabel }) : t("garage.collector")}
        </span>
        {nextLabel && (
          <span className="arch-siguiente">
            {t("garage.nextTierAt", { label: nextLabel, count: tier.next.required })}
          </span>
        )}
      </div>
    </section>
  );
}

// ============================================================================
// La repesca
// ============================================================================
//
// La tarjeta ÁMBAR, que en «Asfalto» es el color de «hay algo disponible»: el
// mismo del punto de la pestaña Archivo y de la tarjeta del final de partida.
// Solo es ámbar cuando se puede hacer algo (sortear o continuar); jugada la de
// hoy, o sin pendientes, pasa a tarjeta neutra y sin botón — un CTA apagado
// que no lleva a ningún sitio es ruido.

function BackIssuesBand({
  poolSize,
  available,
  hasActive,
  starting,
  onClick,
  onOpenHelp,
}) {
  const { t, tn } = useT();
  const pendientes = tn("garage.pendientes", poolSize);

  let titulo = t("garage.repescaDisponible");
  let cuerpo = t("garage.repescaResumen", { pendientes });
  let cta = t("garage.repescaPlay");
  let activa = true;
  if (starting) {
    cta = t("garage.repescaStarting");
  } else if (hasActive) {
    titulo = t("garage.repescaACurso");
    cta = t("garage.repescaContinue");
  } else if (poolSize === 0) {
    titulo = t("garage.repescaAlDia");
    cuerpo = t("garage.backIssuesNone");
    cta = null;
    activa = false;
  } else if (!available) {
    titulo = t("garage.repescaJugada");
    cuerpo = t("garage.repescaManana", { pendientes });
    cta = null;
    activa = false;
  }

  return (
    <section className={"arch-repesca" + (activa ? " activa" : "")}>
      <span className="arch-repesca-icono" aria-hidden="true">
        <Icon d={I.shuffle} size={22} />
      </span>
      <span className="arch-repesca-texto">
        <b>{titulo}</b>
        <span>{cuerpo}</span>
        <button type="button" className="arch-repesca-ayuda" onClick={onOpenHelp}>
          {t("garage.helpRepesca")}
        </button>
      </span>
      {cta && (
        <button
          type="button"
          className="arch-repesca-boton"
          onClick={onClick}
          disabled={starting}
          aria-busy={starting}
        >
          {cta}
        </button>
      )}
    </section>
  );
}

// ============================================================================
// Filtro por país
// ============================================================================

function FilterStrip({ countries, total, active, onSelect }) {
  const { t } = useT();
  return (
    <div className="arch-filtros">
      <div className="arch-tira" role="group" aria-label={t("garage.filterAria")}>
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-pressed={!active}
          className={"arch-chip" + (!active ? " on" : "")}
        >
          {t("garage.filterAll")}
          <span className="cifra">{total}</span>
        </button>

        {countries.map((c) => {
          const tier = countryTier(c.unlocked, c.total);
          const on = active === c.pais;
          return (
            <button
              key={c.pais}
              type="button"
              onClick={() => onSelect(c.pais)}
              aria-pressed={on}
              className={"arch-chip" + (on ? " on" : "")}
            >
              <img
                src={flagImagePath(c.pais)}
                alt=""
                aria-hidden="true"
                draggable={false}
                loading="lazy"
                className="bandera"
              />
              {getLocalizedCountry(c.pais)}
              <span className="cifra">{c.unlocked}</span>
              {tier && <TierMedal tier={tier} size={12} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// La vitrina: la última portada en grande y el resto en fichas
// ============================================================================
//
// La portada MÁS RECIENTE abre la vitrina con su fotografía: es la que el
// jugador acaba de ganar y la que viene a ver. El resto va en FICHAS con el
// logotipo de la marca — una pared de ochenta fotos a 170px no se lee como
// colección sino como ruido, y cada foto sigue a un toque, en el detalle.
// Solo en orden «recientes»: por año o por rareza, «la última» no significa
// nada y la vitrina es una rejilla sin más.

function Showcase({ covers, newIds, order, onSelectCar }) {
  const { t } = useT();

  if (covers.length === 0) {
    return (
      <div className="arch-vitrina">
        <div className="arch-vacio">
          <p className="arch-vacio-titulo">{t("garage.emptyTitle")}</p>
          <p className="arch-vacio-texto">{t("garage.emptyBody")}</p>
        </div>
      </div>
    );
  }

  const destacada = order === "recent" ? covers[0] : null;
  const resto = destacada ? covers.slice(1) : covers;

  return (
    <div className="arch-vitrina">
      {destacada && (
        <Destacada
          car={destacada}
          isNew={newIds.has(destacada.id)}
          onClick={() => onSelectCar(destacada)}
        />
      )}
      {resto.length > 0 && (
        <div className="arch-rejilla">
          {resto.map((car) => (
            <Ficha
              key={car.id}
              car={car}
              isNew={newIds.has(car.id)}
              onClick={() => onSelectCar(car)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// La página de un país: sus marcas, con sus portadas y sus huecos
// ============================================================================

function CountryPage({ country, newIds, onSelectCar }) {
  const brands = useMemo(() => groupByBrand(country.cars), [country]);
  const pct = country.total
    ? Math.min(100, Math.round((country.unlocked / country.total) * 100))
    : 0;
  const complete = country.total > 0 && country.unlocked >= country.total;

  return (
    <div className="arch-vitrina">
      <section className="arch-pais">
        <div className="arch-pais-cab">
          <img
            src={flagImagePath(country.pais)}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="bandera"
          />
          <h3>{getLocalizedCountry(country.pais)}</h3>
          <span className="cifra">
            {country.unlocked}/{country.total}
          </span>
        </div>
        <span className="arch-barra" aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </span>
      </section>

      {brands.map((brand) => (
        <BrandSection
          key={brand.marca}
          brand={brand}
          newIds={newIds}
          onSelectCar={(car) => onSelectCar({ ...car, pais: country.pais })}
        />
      ))}

      {complete && <SpecialCard country={country} />}
    </div>
  );
}

function BrandSection({ brand, newIds, onSelectCar }) {
  const tier = brandTier(brand.unlocked, brand.total);

  return (
    <section className="arch-marca-seccion">
      <div className="arch-marca-cab">
        <LogoMarca marca={brand.marca} apagado={brand.unlocked === 0} pequeno />
        <span className="nombre">{brand.marca}</span>
        {tier && <TierMedal tier={tier} size={14} />}
        <span className="cifra">
          {brand.unlocked}/{brand.total}
        </span>
      </div>

      <div className="arch-rejilla">
        {brand.cars.map((car) =>
          car.unlocked ? (
            <Ficha
              key={car.id}
              car={car}
              isNew={newIds.has(car.id)}
              onClick={() => onSelectCar(car)}
            />
          ) : (
            <Hole
              key={car.id}
              onClick={() => onSelectCar({ ...car, locked: true })}
            />
          )
        )}
      </div>
    </section>
  );
}

// El set completo de un país: la única tarjeta en oro de la vitrina, porque es
// la única que se ha ganado entera.
function SpecialCard({ country }) {
  const { t } = useT();
  return (
    <div className="arch-especial">
      <span className="arch-especial-icono" aria-hidden="true">
        <Icon d={I.estrella} size={20} />
      </span>
      <span className="arch-especial-texto">
        <span className="kicker">{t("garage.specialKicker")}</span>
        <span className="titulo">{getLocalizedCountry(country.pais)}</span>
        <span className="sub">{t("garage.specialSub", { total: country.total })}</span>
      </span>
    </div>
  );
}

// ============================================================================
// Las piezas de la vitrina
// ============================================================================

// El logotipo de la marca, sobre su azulejo blanco: los logotipos se dibujaron
// para fondo claro, y en noche un PNG oscuro sobre grafito desaparece. Si el
// fichero no existe, la inicial — un hueco roto en mitad de la rejilla delata
// el catálogo a medio hacer.
function LogoMarca({ marca, apagado = false, pequeno = false }) {
  const [fallo, setFallo] = useState(false);
  const inicial = Array.from(String(marca || "").trim())[0] || "·";
  return (
    <span
      className={"arch-logo" + (apagado ? " apagado" : "") + (pequeno ? " pequeno" : "")}
      aria-hidden="true"
    >
      {fallo ? (
        <b>{inicial.toLocaleUpperCase()}</b>
      ) : (
        <img
          src={brandLogoPath(marca)}
          alt=""
          draggable={false}
          loading="lazy"
          onError={() => setFallo(true)}
        />
      )}
    </span>
  );
}

// Los distintivos de una portada: el pleno y el veterano en oro (se ganan), la
// repesca en ámbar (dice de dónde vino, no cuánto costó).
const ICONO_MERITO = { pleno: I.estrella, vet: I.galones };

function Distintivo({ merito }) {
  const { t } = useT();
  return (
    <span className={`arch-distintivo ${merito}`} title={t(`garage.merit_${merito}_aria`)}>
      {ICONO_MERITO[merito] && <Icon d={ICONO_MERITO[merito]} size={12} strokeWidth="2" />}
      {t(`garage.merit_${merito}`)}
    </span>
  );
}

function Destacada({ car, isNew, onClick }) {
  const { t } = useT();
  const stamps = stampsOf(car);
  return (
    <button type="button" onClick={onClick} className="arch-destacada focus-ring">
      <span className="arch-destacada-foto">
        <img
          src={apiUrl(car.img)}
          alt={`${car.marca} ${car.modelo}`}
          draggable={false}
          loading="lazy"
        />
        {isNew && <span className="arch-chip-foto nueva">{t("garage.ribbonNew")}</span>}
        <span className="arch-chip-foto num">
          {t("garage.issueShort")} {issueLabel(car.issue)}
        </span>
      </span>
      <span className="arch-destacada-pie">
        <span className="arch-ficha-nombre">
          <span className="arch-marca">{car.marca}</span>
          <span className="arch-modelo grande">{car.modelo}</span>
        </span>
        <span className="arch-destacada-datos">
          {stamps.map((m) => (
            <Distintivo key={m} merito={m} />
          ))}
          {car.pais && (
            <img
              src={flagImagePath(car.pais)}
              alt={getLocalizedCountry(car.pais)}
              draggable={false}
              loading="lazy"
              className="bandera"
            />
          )}
          <span className="arch-anio">{car.anio}</span>
        </span>
      </span>
    </button>
  );
}

function Ficha({ car, isNew, onClick }) {
  const { t } = useT();
  const stamps = stampsOf(car);
  return (
    <button type="button" onClick={onClick} className="arch-ficha focus-ring">
      <span className="arch-ficha-cab">
        <LogoMarca marca={car.marca} />
        <span className="arch-ficha-num">
          {isNew && <span className="arch-nuevo">{t("garage.ribbonNew")}</span>}
          {t("garage.issueShort")} {issueLabel(car.issue)}
        </span>
      </span>
      <span className="arch-ficha-nombre">
        <span className="arch-marca">{car.marca}</span>
        <span className="arch-modelo">{car.modelo}</span>
        <span className="arch-ficha-pie">
          <span className="arch-anio">{car.anio}</span>
          {stamps.length > 0 && (
            <span className="arch-distintivos">
              {stamps.map((m) => (
                <Distintivo key={m} merito={m} />
              ))}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

// El hueco: un número que falta. Rayado y con el canto en discontinua — se lee
// como «aquí va algo» sin enseñar qué. Sin número de edición a propósito: el
// del hueco diría qué día fue coche del día un coche que aún no has ganado.
function Hole({ onClick }) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      className="arch-hueco focus-ring"
      aria-label={t("garage.ariaLockedCard")}
    >
      <span className="arch-ficha-cab">
        <span className="arch-logo cerrado">
          <Icon d={I.candado} size={17} />
        </span>
      </span>
      <span className="arch-ficha-nombre">
        <span className="arch-modelo">{t("garage.lockedLabel")}</span>
        <span className="arch-hueco-sub">{t("garage.holeSub")}</span>
      </span>
    </button>
  );
}

// ============================================================================
// El detalle: la portada que se voltea
// ============================================================================

function CoverDetail({ open, car, collectors = 0, onClose, onStartRepesca }) {
  const { t, tn, dateLocale } = useT();
  // Conservamos el último coche mostrado mientras dura la animación de
  // salida: si no, al poner `car` a null el contenido se vaciaría antes de
  // que el panel termine de irse.
  const [displayCar, setDisplayCar] = useState(car);
  const [angle, setAngle] = useState(0);
  useEffect(() => {
    if (car) setDisplayCar(car);
  }, [car]);
  // Cada portada nueva se abre por la cara, nunca por el dorso.
  useEffect(() => {
    if (open) setAngle(0);
  }, [open, car?.id]);

  const isLocked = displayCar?.locked;
  const stamps = displayCar ? stampsOf(displayCar) : [];
  const merits = displayCar ? meritsOf(displayCar) : [];
  const wonAt = formatWonAt(displayCar?.wonAt, dateLocale);
  const rarity = displayCar?.rarity || null;
  const rarityKind = rarity ? rarityTier(rarity.pct) : null;
  const rarityPct = rarity ? formatRarityPct(rarity.pct) : null;

  const drag = useFlipDrag(angle, setAngle);
  const flipped = showsBack(drag.currentAngle);

  // La carta mide lo que mide la cara VISIBLE (ver `.arch-flip-inner`).
  const portadaRef = useRef(null);
  const dorsoRef = useRef(null);
  const [faceH, setFaceH] = useState(null);
  useLayoutEffect(() => {
    const portada = portadaRef.current;
    const dorso = dorsoRef.current;
    if (!portada || !dorso) return;
    const measure = () => {
      const h = (flipped ? dorso : portada).offsetHeight;
      if (h) setFaceH(h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(portada);
    ro.observe(dorso);
    return () => ro.disconnect();
  }, [flipped, displayCar]);

  // Las flechas del teclado también voltean: el swipe no es el único camino.
  useEffect(() => {
    if (!open || isLocked) return;
    const onKey = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      setAngle((a) => a + (e.key === "ArrowRight" ? 180 : -180));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isLocked]);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={t("garage.headerTitle")}
      backdropClassName="modal-scrim fixed inset-0 z-[95] flex items-center justify-center p-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm max-h-[88vh] overflow-y-auto"
    >
      {displayCar && (
        <>
          {/* La X vive en su propia banda, FUERA del cromo: queda fuera del
              contenedor que rota, así que no gira con la carta. */}
          <div className="flex justify-end px-2 pt-2">
            <CloseButton onClick={onClose} />
          </div>

          {isLocked ? (
            /* Hueco: aquí SÍ enseñamos la lona borrosa (una sola petición, y
               solo cuando el usuario ha mostrado interés tocando el hueco).
               Es el momento de intriga: "¿qué se esconde ahí?". */
            <div className="arch-detalle">
              <div className="arch-detalle-foto">
                {displayCar.img && (
                  <img
                    src={apiUrl(displayCar.img)}
                    alt=""
                    aria-hidden="true"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                )}
                <div className="arch-detalle-velo">
                  <Icon d={I.candado} size={30} />
                  <p>{t("garage.lockedLabel")}</p>
                </div>
              </div>

              <p className="arch-marca">{displayCar.marca}</p>
              <p className="arch-detalle-modelo">{t("garage.modelHidden")}</p>
              <p className="arch-detalle-texto">{t("garage.lockedCardDetailBody")}</p>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onStartRepesca?.();
                }}
                className="pm-btn arch-boton-ambar"
              >
                {t("garage.lockedCardDetailCta")}
              </button>
            </div>
          ) : (
            /* Las dos caras están SIEMPRE montadas (si no, no hay volteo que
               animar), así que la que mira hacia atrás se marca aria-hidden y
               su botón sale del orden de tabulación. */
            <div className="arch-flip" {...drag.handlers}>
              <div
                className={`arch-flip-inner ${drag.dragging ? "arrastrando" : ""}`}
                style={{
                  transform: `rotateY(${drag.currentAngle}deg)`,
                  height: faceH ? `${faceH}px` : undefined,
                }}
              >
                {/* ── Cara: la portada ── */}
                <div
                  ref={portadaRef}
                  className="arch-cara arch-cara--portada arch-detalle"
                  aria-hidden={flipped}
                >
                  {/* object-CONTAIN: en el detalle la foto se ve ENTERA. Las
                      bandas que deja el encaje son del fondo del marco, como el
                      paspartú de una foto montada. */}
                  <div className="arch-detalle-foto">
                    <img
                      src={apiUrl(displayCar.img)}
                      alt={`${displayCar.marca} ${displayCar.modelo}`}
                      draggable={false}
                    />
                    <span className="arch-chip-foto num">
                      {t("garage.issueShort")} {issueLabel(displayCar.issue)}
                    </span>
                    {stamps.length > 0 && (
                      <span className="arch-detalle-sellos">
                        {stamps.map((m) => (
                          <Distintivo key={m} merito={m} />
                        ))}
                      </span>
                    )}
                  </div>

                  <p className="arch-marca">{displayCar.marca}</p>
                  <h3 className="arch-detalle-modelo">{displayCar.modelo}</h3>
                  <p className="arch-detalle-chapas">
                    {displayCar.pais && (
                      <span className="fin-chapa">
                        <img
                          src={flagImagePath(displayCar.pais)}
                          alt=""
                          aria-hidden="true"
                          draggable={false}
                          className="bandera"
                        />
                        {getLocalizedCountry(displayCar.pais)}
                      </span>
                    )}
                    {displayCar.anio && <span className="fin-chapa mono">{displayCar.anio}</span>}
                  </p>

                  {/* El click sintético que sigue a un swipe se descarta: si
                      no, un swipe que empieza y acaba sobre este botón
                      voltearía dos veces y la carta se quedaría igual. */}
                  <button
                    type="button"
                    onClick={() => {
                      if (drag.consumeDrag()) return;
                      setAngle((a) => a + 180);
                    }}
                    tabIndex={flipped ? -1 : 0}
                    className="pm-btn pm-btn--ghost"
                  >
                    {t("garage.flipToBack")}
                  </button>
                  {/* El swipe es un gesto nuevo y no se descubre solo: una
                      línea de pie basta. Solo en la portada. */}
                  <p className="arch-pista">{t("garage.flipHint")}</p>
                </div>

                {/* ── Cara: el dorso ── */}
                <div
                  ref={dorsoRef}
                  className="arch-cara arch-cara--dorso arch-detalle"
                  aria-hidden={!flipped}
                >
                  <div className="arch-dorso-cab">
                    <span>
                      {displayCar.marca} · {displayCar.modelo}
                    </span>
                    <span className="num">
                      {t("garage.issueShort")} {issueLabel(displayCar.issue)}
                    </span>
                  </div>

                  <p className="arch-etiqueta">{t("garage.carSpec")}</p>
                  <p className="arch-detalle-texto">
                    {getCarDescription(displayCar) || t("garage.carNoDescription")}
                  </p>

                  {/* TIRADA: cuánta gente tiene esta portada. Va ANTES de "en
                      tu archivo" porque es el dato que no depende de ti. Se
                      omite entero si el servidor no publica rareza: mejor
                      callar que inventar escasez. */}
                  {rarity && rarityPct !== null && (
                    <div className={`arch-tirada t-${rarityKind}`}>
                      <p className="arch-etiqueta">{t("garage.rarityTitle")}</p>
                      <p className="etiqueta">{t(`garage.rarity_${rarityKind}`)}</p>
                      <p className="apoyo">
                        {t("garage.rarityBody", {
                          pct: rarityPct,
                          collectors,
                        })}
                      </p>
                    </div>
                  )}

                  <p className="arch-etiqueta">{t("garage.backTitle")}</p>
                  <div className="arch-datos">
                    {wonAt && (
                      <div className="arch-dato">
                        <span className="k">{t("garage.datoWonAt")}</span>
                        <span className="v">{wonAt}</span>
                      </div>
                    )}
                    {/* Origen: un cromo rescatado de un número atrasado no se
                        consiguió igual que uno del día. */}
                    <div className="arch-dato">
                      <span className="k">{t("garage.datoOrigin")}</span>
                      <span className="v">
                        {t(
                          displayCar.viaRepesca
                            ? "garage.originRepesca"
                            : "garage.originDaily"
                        )}
                      </span>
                    </div>
                    {Number.isFinite(displayCar.attempts) && (
                      <div className="arch-dato">
                        <span className="k">{t("garage.datoAttempts")}</span>
                        {/* El oro marca el pleno, no el número: en la repesca
                            veterana solo hay un intento, así que celebrarlo
                            sería celebrar una hazaña que no es. */}
                        <span
                          className={`v ${
                            displayCar.attempts === 1 && !displayCar.viaRepesca
                              ? "oro"
                              : ""
                          }`}
                        >
                          {tn("garage.attemptsN", displayCar.attempts)}
                        </span>
                      </div>
                    )}
                    <div className="arch-dato">
                      <span className="k">{t("garage.datoMerit")}</span>
                      <span className={`v ${merits.length ? "oro" : ""}`}>
                        {merits.length
                          ? merits.map((m) => t(`garage.merit_${m}`)).join(" · ")
                          : t("garage.datoMeritNone")}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (drag.consumeDrag()) return;
                      setAngle((a) => a - 180);
                    }}
                    tabIndex={flipped ? 0 : -1}
                    className="pm-btn pm-btn--ghost"
                  >
                    {t("garage.flipToFront")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </ModalShell>
  );
}

// ============================================================================
// ¿Sortear un coche? — la pregunta antes del sorteo
// ============================================================================
//
// Es una DECISIÓN (regla 24), así que va centrada en las dos plataformas. El
// botón principal es ámbar y no tinta: es el único sitio del juego donde se
// gasta la repesca del día, y el color dice de qué se está hablando.

function RandomRepescaConfirm({ open, poolSize, starting, onCancel, onAccept }) {
  const { t } = useT();
  return (
    <ModalShell
      open={open}
      onClose={onCancel}
      dismissOnBackdrop={!starting}
      label={t("garage.repescaConfirmTitle")}
      backdropClassName="modal-scrim safe-area-pad fixed inset-0 z-[95] flex items-center justify-center px-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm max-h-full overflow-y-auto overscroll-contain"
    >
      <div className="arch-dialogo">
        <span className="arch-dialogo-cab">
          <span className="arch-kicker ambar">{t("garage.repescaTag")}</span>
          <h3 className="arch-dialogo-titulo">{t("garage.repescaConfirmTitle")}</h3>
        </span>
        <p className="arch-dialogo-texto">{t("garage.repescaConfirmBody", { poolSize })}</p>
        <ul className="arch-reglas">
          <li>
            <Icon d={I.calendario} size={18} />
            {t("garage.reglaUnaAlDia")}
          </li>
          <li>
            <span className="medio" aria-hidden="true">½</span>
            {t("garage.reglaMitad")}
          </li>
          <li>
            <Icon d={I.escudo} size={18} />
            {t("garage.reglaRacha")}
          </li>
        </ul>
        <button
          type="button"
          onClick={onAccept}
          disabled={starting}
          className="pm-btn arch-boton-ambar"
          aria-busy={starting}
        >
          {starting ? t("garage.repescaStarting") : t("garage.repescaAccept")}
        </button>
        <button type="button" onClick={onCancel} disabled={starting} className="arch-ahora-no">
          {t("garage.ahoraNo")}
        </button>
      </div>
    </ModalShell>
  );
}

// ============================================================================
// Piezas pequeñas
// ============================================================================

// La medalla de un rango (bronce, plata, oro). El color lo pone el CSS desde
// los tokens del podio: los hex fijos de antes se habían oscurecido para el
// papel crema y en noche se apagaban sobre el grafito.
function TierMedal({ tier, size = 16 }) {
  if (!tier) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`arch-medalla tier-${tier}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="14" r="6" fill="currentColor" fillOpacity="0.18" />
      <path d="M9 9 6.5 3.5M15 9l2.5-5.5" />
      <circle cx="12" cy="14" r="6" />
    </svg>
  );
}

function CenterMessage({ text, tone = "default", onRetry = null }) {
  const { t } = useT();
  return (
    <div className="arch-mensaje">
      <p className={tone === "error" ? "rojo" : undefined}>{text}</p>
      {/* UNA SALIDA, no solo un diagnóstico: sin este botón, la única forma de
          reintentar era cerrar el panel y abrirlo otra vez, y eso hay que
          adivinarlo. */}
      {onRetry && (
        <button type="button" onClick={onRetry} className="pm-btn pm-btn--ghost">
          {t("offline.retry")}
        </button>
      )}
    </div>
  );
}

function RepescaHelpModal({ open, onClose }) {
  const { t } = useT();
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={t("garage.repescaHelpTitle")}
      backdropClassName="modal-scrim safe-area-pad fixed inset-0 z-[95] flex items-center justify-center px-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm max-h-full overflow-y-auto overscroll-contain"
    >
      <div className="arch-dialogo">
        <div className="arch-dialogo-fila">
          <span className="arch-dialogo-cab">
            <span className="arch-kicker ambar">{t("garage.repescaHelpTag")}</span>
            <h3 className="arch-dialogo-titulo">{t("garage.repescaHelpTitle")}</h3>
          </span>
          <CloseButton onClick={onClose} />
        </div>
        <p className="arch-dialogo-texto">{t("garage.repescaHelpBody")}</p>

        <div className="arch-ayuda-lista">
          <HelpRow icon={<Icon d={I.shuffle} size={18} />} title={t("garage.repescaHelpSurprise")}>
            {t("garage.repescaHelpSurpriseDesc")}
          </HelpRow>
          <HelpRow icon={<Icon d={I.calendario} size={18} />} title={t("garage.repescaHelpOnce")}>
            {t("garage.repescaHelpOnceDesc")}
          </HelpRow>
          <HelpRow icon={<span className="medio">½</span>} title={t("garage.repescaHelpHalf")}>
            {t("garage.repescaHelpHalfDesc")}
          </HelpRow>
          <HelpRow icon={<Icon d={I.escudo} size={18} />} title={t("garage.repescaHelpNoStreak")}>
            {t("garage.repescaHelpNoStreakDesc")}
          </HelpRow>
          <HelpRow icon={<Icon d={I.galones} size={18} />} title={t("garage.repescaHelpVeteran")}>
            {t("garage.repescaHelpVeteranDesc")}
          </HelpRow>
        </div>

        <button type="button" onClick={onClose} className="pm-btn">
          {t("garage.repescaHelpOk")}
        </button>
      </div>
    </ModalShell>
  );
}

function HelpRow({ icon, title, children }) {
  return (
    <div className="arch-ayuda-fila">
      <span className="arch-ayuda-icono" aria-hidden="true">{icon}</span>
      <span className="arch-ayuda-texto">
        <b>{title}</b>
        <span>{children}</span>
      </span>
    </div>
  );
}

function AuthWall({ onLogin }) {
  const { t } = useT();
  return (
    <div className="arch-mensaje">
      <div className="arch-muro">
        <p className="arch-vacio-titulo">{t("garage.authTitle")}</p>
        <p className="arch-vacio-texto">{t("garage.authBody")}</p>
        {/* Sin el glifo de Google y sin su nombre: este botón ABRE LA PUERTA,
            que ofrece Google y también el código por correo. */}
        <button type="button" onClick={onLogin} className="pm-btn">
          {t("common.signIn")}
        </button>
      </div>
    </div>
  );
}
