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
import AchievementIcon from "./AchievementIcons";
import RepescaDrawAnimation from "./RepescaDrawAnimation";
import { track, plataforma } from "../lib/analytics";
import { captureClientError } from "../lib/sentry";
import { flagImagePath } from "../data/countries";
import { apiUrl } from "../lib/apiUrl";
import { countryTier, brandTier, collectorTier, TIER_HEX } from "../lib/collectionTier";
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

// Slug de marca según especificación del usuario: simple lowercase + spaces→-.
// No quitamos acentos a propósito (es como el usuario nombra los .png).
function brandSlug(marca) {
  return String(marca || "").toLowerCase().replace(/\s+/g, "-");
}

function brandLogoPath(marca) {
  return `/brands/${brandSlug(marca)}.png`;
}

export default function Garage({ open, onClose, user, onOpenLogin, onOpenAchievements }) {
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

  // La última portada conseguida, para el titular del masthead. Se calcula
  // SIEMPRE por recencia, independientemente del orden que elija el usuario.
  const lastCover = useMemo(() => {
    const byDate = sortCovers(collectCovers(state.data?.countries), "recent");
    return byDate[0] || null;
  }, [state.data]);

  // Tamaño de la pool de repesca: cuántos coches ya fueron daily y el
  // usuario aún no los ha ganado. Lo calcula el servidor en /api/garage
  // (`repescaPoolSize`) — antes lo derivábamos en cliente con `wasDaily`
  // por-coche, pero esa señal permitía un cheat pasivo (filtrar locked +
  // !wasDaily revelaba candidatos a coche-del-día). Ahora solo recibimos
  // el agregado. El servidor también es quien elige el coche concreto en
  // /api/repesca/start (CSPRNG), así que el cliente nunca necesita los ids.
  const repescaPoolSize = state.data?.repescaPoolSize ?? 0;

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
              relative flex w-full max-w-md flex-col overflow-hidden
              border-x border-border bg-papel
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

            {/* Cabecera fija: la cabecera del periódico. No cambia al filtrar
                —el archivo es el mismo— así el usuario nunca se pierde.
                `safe-area-top` le suma el inset de la barra de estado: este
                panel va a pantalla completa y sin eso el titular se dibuja bajo
                el reloj del sistema. El aire propio (los 0.75rem del antiguo
                py-3) viaja en la variable y no en un `pt-3`, porque la clase
                pisaría la utilidad — ver el comentario de index.css. */}
            <div
              className="safe-area-top flex items-center justify-between gap-3 border-b border-border px-4 pb-3"
              style={{ "--safe-area-extra-top": "0.75rem" }}
            >
              <div className="min-w-0">
                <p className="pm-kicker">{t("garage.headerCollection")}</p>
                <h2 className="truncate font-display text-[26px] font-black leading-none tracking-tight text-tinta">
                  {t("garage.headerTitle")}
                </h2>
              </div>
              <div className="flex flex-none items-center gap-1">
                <button
                  type="button"
                  onClick={() => { onClose(); onOpenAchievements?.(); }}
                  aria-label={t("header.achievements")}
                  title={t("header.achievements")}
                  className="focus-ring flex h-9 w-9 items-center justify-center text-muted transition-colors hover:text-accent"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="8" r="5" />
                    <path d="M8.21 13.89 7 22l5-3 5 3-1.21-8.11" />
                  </svg>
                </button>
                <CloseButton onClick={onClose} />
              </div>
            </div>

            {/* Cuerpo */}
            {!user ? (
              <AuthWall
                onLogin={() => {
                  onClose();
                  onOpenLogin?.();
                }}
              />
            ) : state.loading ? (
              <CenterMessage text={t("garage.loading")} pulse />
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
                      lastCover={lastCover}
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
                        onChangeOrder={setOrder}
                        onSelectCar={setDetailCar}
                        hasRarity={(state.data?.rarityCollectors || 0) > 0}
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
        />
      )}
    </AnimatePresence>
  );
}

// ============================================================================
// Masthead: el titular del archivo
// ============================================================================
//
// Sustituye a la barra de progreso global + "47 / 1200". Sobre un catálogo
// grande ese porcentaje vive permanentemente cerca de cero: una barra vacía
// que solo comunica lo lejos que estás. Aquí el titular es lo que TIENES, y
// el hilo de nivel (tier de coleccionista, compartido con el carnet del
// Perfil) baja a una línea de pie, no a un chip que compite con el número.

function Masthead({ total, lastCover }) {
  const { t, tn, locale } = useT();
  const tier = collectorTier(total);
  const tierLabel = tier.tier ? tier.label?.[locale] || tier.label?.es : null;
  const nextLabel = tier.next ? tier.next.label?.[locale] || tier.next.label?.es : null;

  return (
    <div className="px-4 pb-3 pt-4">
      <p className="pm-label">{t("garage.mastheadKicker")}</p>
      <h3 className="mt-1 font-display text-[34px] font-black leading-none tracking-tight text-tinta">
        <span className="tabular-nums">{total}</span>{" "}
        <span className="text-[19px] font-bold">{tn("garage.covers", total)}</span>
      </h3>

      {lastCover && (
        <p className="mt-1.5 truncate font-mono text-[11px] text-muted">
          {t("garage.lastIssue", {
            issue: issueLabel(lastCover.issue),
            model: `${lastCover.marca} ${lastCover.modelo}`,
          })}
        </p>
      )}

      <div className="arch-filete mt-3 flex items-center justify-between gap-3 pt-2">
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider">
          <CollectionIcon className="h-3.5 w-3.5 text-gold" />
          <span className="text-muted">{t("garage.collector")}</span>
          {tierLabel && <span className="font-bold text-gold">{tierLabel}</span>}
        </span>
        {nextLabel && (
          <span className="truncate font-mono text-[10px] text-muted">
            {t("garage.nextTierAt", {
              label: nextLabel,
              count: tier.next.required,
            })}
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Números atrasados (repesca)
// ============================================================================
//
// El mismo motor de siempre, reencuadrado: deja de ser "un botón de app" y
// pasa a ser la sección del archivo donde se piden los números que faltan.
// La narrativa es gratis y hace que el modo Repesca deje de parecer un
// añadido para parecer parte de la revista.

function BackIssuesBand({
  poolSize,
  available,
  hasActive,
  starting,
  onClick,
  onOpenHelp,
}) {
  const { t, tn } = useT();

  // Cuatro estados, mismo orden de prioridad que el CTA anterior.
  let cta = t("garage.repescaPlay");
  let body = tn("garage.backIssuesPending", poolSize);
  let disabled = false;
  if (starting) {
    cta = t("garage.repescaStarting");
    disabled = true;
  } else if (hasActive) {
    cta = t("garage.repescaContinue");
  } else if (poolSize === 0) {
    cta = t("garage.repescaComplete");
    body = t("garage.backIssuesNone");
    disabled = true;
  } else if (!available) {
    cta = t("garage.repescaNoneToday");
    // Un botón apagado sin explicación se lee como avería. La línea dice qué
    // ha pasado y cuándo vuelve a haber: es el estado en el que MÁS falta hace
    // hablar, porque el jugador acaba de terminar su repesca del día.
    body = t("garage.backIssuesTomorrow");
    disabled = true;
  }

  return (
    <div className="mx-4 mb-3 border border-border bg-papel-mat px-3 py-2.5">
      <div className="flex items-center gap-3">
        <DiceIcon className="h-5 w-5 flex-none text-accent" />
        <div className="min-w-0 flex-1">
          <p className="pm-label">{t("garage.backIssuesTitle")}</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-tinta">{body}</p>
        </div>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-busy={starting}
          className="
            flex-none border border-tinta bg-tinta px-3 py-1.5
            font-body text-[10px] font-extrabold uppercase tracking-[0.18em] text-papel
            transition-colors hover:bg-accent hover:border-accent
            disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent
            disabled:text-muted
          "
        >
          {cta}
        </button>
      </div>
      <button
        type="button"
        onClick={onOpenHelp}
        className="mt-1.5 font-mono text-[10px] text-muted underline underline-offset-2 transition-colors hover:text-accent"
      >
        {t("garage.helpRepesca")}
      </button>
    </div>
  );
}

// ============================================================================
// Tira de filtros de país
// ============================================================================
//
// Antes esto era una VISTA entera (lista de países) y una segunda vista de
// marcas encima. Al bajarlo a chips, ver un cromo pasa de tres taps a cero, y
// saltar de Italia a Alemania de "atrás + entrar" a un solo toque.

function FilterStrip({ countries, total, active, onSelect }) {
  const { t } = useT();
  return (
    <div className="sticky top-0 z-10 border-y border-border bg-papel">
      <div
        className="arch-tira flex gap-1.5 overflow-x-auto px-4 py-2"
        role="group"
        aria-label={t("garage.filterAria")}
      >
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-pressed={!active}
          className={`pm-chip ${!active ? "on" : ""}`}
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
              className={`pm-chip ${on ? "on" : ""}`}
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
              <span className="cifra">
                {c.unlocked}/{c.total}
              </span>
              {tier && <TierMedal tier={tier} className="h-3 w-3" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Vitrina: TODAS tus portadas
// ============================================================================

function Showcase({ covers, newIds, order, onChangeOrder, onSelectCar, hasRarity }) {
  const { t } = useT();

  if (covers.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center border border-border">
          <CollectionIcon className="h-7 w-7 text-muted" />
        </div>
        <p className="font-display text-xl font-black text-tinta">
          {t("garage.emptyTitle")}
        </p>
        <p className="pm-body mx-auto mt-2 max-w-[36ch]">{t("garage.emptyBody")}</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      {/* Selector de orden: palabras sueltas, sin caja. "Rareza" solo aparece
          cuando el servidor publica el dato — un orden que no ordena nada es
          peor que no ofrecerlo. */}
      <div className="mb-2.5 flex items-center justify-end gap-2 font-mono text-[10px] uppercase tracking-wider">
        <span className="text-muted">{t("garage.sortAria")}</span>
        <OrderButton on={order === "recent"} onClick={() => onChangeOrder("recent")}>
          {t("garage.sortRecent")}
        </OrderButton>
        <span className="text-muted/50" aria-hidden="true">·</span>
        <OrderButton on={order === "year"} onClick={() => onChangeOrder("year")}>
          {t("garage.sortYear")}
        </OrderButton>
        {hasRarity && (
          <>
            <span className="text-muted/50" aria-hidden="true">·</span>
            <OrderButton on={order === "rarity"} onClick={() => onChangeOrder("rarity")}>
              {t("garage.sortRarity")}
            </OrderButton>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 pb-4 sm:grid-cols-3">
        {covers.map((car) => (
          <Cover
            key={car.id}
            car={car}
            isNew={newIds.has(car.id)}
            onClick={() => onSelectCar(car)}
          />
        ))}
      </div>
    </div>
  );
}

function OrderButton({ on, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`transition-colors ${
        on ? "font-bold text-tinta underline underline-offset-2" : "text-muted hover:text-tinta"
      }`}
    >
      {children}
    </button>
  );
}

// ============================================================================
// Página de país: el álbum abierto por esa sección
// ============================================================================
//
// Aquí SÍ se pintan los huecos, y es deliberado: en un dominio acotado ("me
// faltan 2 Ferrari") el hueco es un objetivo; en el catálogo entero ("te
// faltan 340") es una factura. Esa es toda la diferencia entre un álbum de
// cromos y una lista de tareas.

function CountryPage({ country, newIds, onSelectCar }) {
  const { t } = useT();
  const brands = useMemo(() => groupByBrand(country.cars), [country]);
  const pct = country.total
    ? Math.min(100, Math.round((country.unlocked / country.total) * 100))
    : 0;
  const complete = country.total > 0 && country.unlocked >= country.total;

  return (
    <div className="px-4 py-3">
      {/* Cabecera de sección. La bandera es una VIÑETA, no un banderón a
          pantalla completa oscurecido con negro: sobre papel, aquel bloque
          oscuro era un agujero en mitad de la revista. */}
      <div className="mb-3">
        <div className="flex items-center gap-2.5">
          <img
            src={flagImagePath(country.pais)}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="h-[15px] w-[22px] flex-none border border-border object-cover"
          />
          <h3 className="min-w-0 flex-1 truncate font-display text-2xl font-black leading-none tracking-tight text-tinta">
            {getLocalizedCountry(country.pais)}
          </h3>
          <span className="flex-none font-mono text-[11px] tabular-nums text-muted">
            {country.unlocked}/{country.total}
          </span>
        </div>
        <div className="arch-regla mt-2">
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>

      {brands.map((brand) => (
        <BrandSection
          key={brand.marca}
          brand={brand}
          newIds={newIds}
          // El país se anota al abrir el detalle porque los coches vienen
          // agrupados por país y no lo llevan dentro (en la vitrina lo añade
          // collectCovers). Sin esto, el dorso perdería la línea de país solo
          // cuando se entra por la página de un país — justo al revés.
          onSelectCar={(car) => onSelectCar({ ...car, pais: country.pais })}
        />
      ))}

      {complete && <SpecialCard country={country} />}

      <div className="h-4" aria-hidden="true" />
    </div>
  );
}

// Cada marca es una PÁGINA del álbum: ladillo con su emblema y su rejilla,
// portadas primero y huecos después (el servidor ya devuelve los cromos en
// ese orden dentro de cada país).
function BrandSection({ brand, newIds, onSelectCar }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const tier = brandTier(brand.unlocked, brand.total);

  return (
    <section className="mb-5">
      {/* Ladillo de marca. Mismo gramaje que .prensa-ladillo, pero con el
          filete ENTRE el nombre y el contador (el ::after del ladillo lo
          empujaría al final, detrás de la cifra). */}
      <div className="mb-2 flex items-center gap-2.5 font-body text-[11px] font-extrabold uppercase tracking-[0.22em] text-tinta">
        {!logoFailed ? (
          <img
            src={brandLogoPath(brand.marca)}
            alt=""
            aria-hidden="true"
            draggable={false}
            loading="lazy"
            onError={() => setLogoFailed(true)}
            className={`h-4 w-4 flex-none object-contain ${
              brand.unlocked > 0 ? "" : "opacity-40 grayscale"
            }`}
          />
        ) : null}
        <span className="min-w-0 truncate">{brand.marca}</span>
        {tier && <TierMedal tier={tier} className="h-3.5 w-3.5 flex-none" />}
        <span className="h-px flex-1 bg-tinta/25" aria-hidden="true" />
        <span className="flex-none font-mono text-[10px] font-normal tracking-normal tabular-nums text-muted">
          {brand.unlocked}/{brand.total}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {brand.cars.map((car) =>
          car.unlocked ? (
            <Cover
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

// Recompensa por completar un país: una portada que no está en el catálogo,
// solo se gana. Es el objetivo que le faltaba a la colección — hasta ahora,
// completar Italia no producía NADA que enseñar.
function SpecialCard({ country }) {
  const { t } = useT();
  return (
    <div className="arch-especial mb-5">
      <p className="kicker">{t("garage.specialKicker")}</p>
      <p className="titulo">{getLocalizedCountry(country.pais)}</p>
      <p className="sub">
        {t("garage.specialSub", { total: country.total })}
      </p>
    </div>
  );
}

// ============================================================================
// La portada (el cromo) y el hueco
// ============================================================================

function Cover({ car, isNew, onClick }) {
  const { t } = useT();
  const merits = stampsOf(car);

  return (
    <button type="button" onClick={onClick} className="arch-portada focus-ring">
      <div className="cab">
        <span className="cabecera">{t("garage.coverMasthead")}</span>
        <span className="num">
          {t("garage.issueShort")} {issueLabel(car.issue)}
        </span>
      </div>

      <div className="foto">
        <img
          // apiUrl(): las portadas vienen como /api/car-image?t=… (ruta
          // relativa). En la app hay que absolutizarlas o el archivo entero
          // se ve sin fotos — el <img> no pasa por el shim de fetch.
          src={apiUrl(car.img)}
          alt={`${car.marca} ${car.modelo}`}
          draggable={false}
          loading="lazy"
        />
      </div>

      <div className="pie">
        <p className="marca">{car.marca}</p>
        <p className="modelo">{car.modelo}</p>
        <p className="anio">{car.anio}</p>
      </div>

      {isNew && <span className="arch-cinta">{t("garage.ribbonNew")}</span>}

      {merits.length > 0 && (
        <span className="arch-sellos">
          {merits.map((m) => (
            <span
              key={m}
              className={`arch-sello arch-sello--${m}`}
              title={t(`garage.merit_${m}_aria`)}
              aria-label={t(`garage.merit_${m}_aria`)}
            >
              {t(`garage.merit_${m}`)}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

// El hueco NO carga imagen (ver .arch-hueco en index.css): la lona borrosa
// solo se pide al abrir el detalle. Aquí es papel en blanco con trama, que
// además es lo que un álbum de cromos enseña de verdad en una casilla vacía.
function Hole({ onClick }) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      className="arch-hueco focus-ring"
      aria-label={t("garage.ariaLockedCard")}
    >
      <span className="num">{t("garage.issueShort")} ???</span>
      <LockIcon className="h-5 w-5 text-tinta/35" />
      <span className="txt">{t("garage.holeTitle")}</span>
    </button>
  );
}

// ============================================================================
// Detalle: la portada a tamaño grande, con dorso
// ============================================================================

function CoverDetail({ open, car, collectors = 0, onClose, onStartRepesca }) {
  const { t, tn, dateLocale } = useT();
  // Conservamos el último coche válido en estado local. Cuando el padre hace
  // setDetailCar(null) para cerrar, `car` pasa a null y `open` a false en el
  // mismo render — pero la animación de salida tarda ~250 ms. Sin esta cache
  // leeríamos car.marca de null durante ese intervalo y reventaría.
  const [displayCar, setDisplayCar] = useState(car);
  // Ángulo ACUMULADO, no un booleano: ver lib/flipAngle.js. Los múltiplos
  // pares de 180° miran a la portada, los impares al dorso.
  const [angle, setAngle] = useState(0);
  useEffect(() => {
    if (car) setDisplayCar(car);
  }, [car]);
  // Cada portada se abre por su cara buena.
  useEffect(() => {
    if (open) setAngle(0);
  }, [open, car?.id]);

  const isLocked = displayCar?.locked;
  // Dos listas, no una: en la portada se estampa también el origen (repesca),
  // pero la línea «Distintivo» del dorso es solo para el mérito — el origen
  // tiene ahí su propia fila y decir «Distintivo: Repesca» sería llamar
  // mérito a haber rescatado un número atrasado.
  const stamps = displayCar ? stampsOf(displayCar) : [];
  const merits = displayCar ? meritsOf(displayCar) : [];
  const wonAt = formatWonAt(displayCar?.wonAt, dateLocale);
  const rarity = displayCar?.rarity || null;
  const rarityKind = rarity ? rarityTier(rarity.pct) : null;
  const rarityPct = rarity ? formatRarityPct(rarity.pct) : null;

  const drag = useFlipDrag(angle, setAngle);
  // La cara visible se deriva del ángulo EN VIVO, así que a mitad de arrastre
  // el dorso ya es "la cara actual" en el mismo instante en que el navegador
  // empieza a pintarlo (backface-visibility cambia a los 90°).
  const flipped = showsBack(drag.currentAngle);

  // ── Altura = la de la CARA VISIBLE ──────────────────────────────────────
  // El dorso casi siempre es más alto (ficha + tirada + datos). Si la carta
  // midiera lo más alto, ver solo la portada dejaría un palmo de aire arriba y
  // abajo. Medimos ambas caras y damos a la carta la altura de la que se está
  // viendo; el cambio salta a los 90° (carta de perfil), donde no se ve, y la
  // transición CSS de `height` lo suaviza.
  const portadaRef = useRef(null);
  const dorsoRef = useRef(null);
  const [faceH, setFaceH] = useState(null);
  useLayoutEffect(() => {
    const portada = portadaRef.current;
    const dorso = dorsoRef.current;
    if (!portada || !dorso) return;
    // Las caras están en `absolute`, así que su offsetHeight es su alto de
    // contenido, independientemente de la rotación del padre. Medir en
    // useLayoutEffect (pre-paint) evita que la carta nazca colapsada a 0.
    const measure = () => {
      const h = (flipped ? dorso : portada).offsetHeight;
      if (h) setFaceH(h);
    };
    measure();
    // La ficha puede crecer tras el primer paint (fuentes que cargan, texto
    // largo que reflowea): el observer mantiene la altura al día sin re-medir
    // en cada frame del arrastre (dependemos de `flipped`, no de `dx`).
    const ro = new ResizeObserver(measure);
    ro.observe(portada);
    ro.observe(dorso);
    return () => ro.disconnect();
  }, [flipped, displayCar]);

  // Flechas ←/→ como equivalente de teclado del arrastre, cada una girando
  // hacia su lado (misma correspondencia que el dedo: derecha → +). Va por
  // listener de ventana y no por onKeyDown del contenedor porque el foco lo
  // tiene el panel de ModalShell (padre): un keydown allí nunca bajaría hasta
  // la carta.
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
      // La carta mide lo que mide la cara visible (ver faceH), así que no hay
      // aire sobrante ni scroll interno: la ficha se lee entera. max-h + scroll
      // es solo la VÁLVULA para el caso patológico —una descripción larguísima
      // que hiciera el dorso más alto que la pantalla—; en una ficha normal no
      // se activa.
      panelClassName="modal-panel-flat relative w-full max-w-sm max-h-[88vh] overflow-y-auto"
    >
      {displayCar && (
        <>
          {/* La X vive en su propia banda, FUERA del cromo. En absolute sobre
              la esquina caía encima de la cabecera de la portada y pisaba el
              nº de edición. Además queda fuera del contenedor que rota, así
              que no gira con la carta. */}
          <div className="flex justify-end px-2 pt-2">
            <CloseButton onClick={onClose} />
          </div>

          {isLocked ? (
            /* Hueco: aquí SÍ enseñamos la lona borrosa (una sola petición, y
               solo cuando el usuario ha mostrado interés tocando el hueco).
               Es el momento de intriga: "¿qué se esconde ahí?". */
            <div className="px-4 pb-4 pt-1">
              <div className="border border-border">
                <div className="flex items-center justify-between border-b border-border px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-muted">
                  <span>{t("garage.coverMasthead")}</span>
                  <span className="text-accent">{t("garage.issueShort")} ???</span>
                </div>
                <div className="arch-paspartu relative aspect-[4/3] w-full overflow-hidden">
                  {displayCar.img && (
                    <img
                      src={apiUrl(displayCar.img)}
                      alt=""
                      aria-hidden="true"
                      className="h-full w-full object-contain"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-papel/70 text-center">
                    <LockIcon className="h-8 w-8 text-tinta/70" />
                    <p className="font-body text-[10px] font-extrabold uppercase tracking-[0.22em] text-tinta/80">
                      {t("garage.lockedLabel")}
                    </p>
                  </div>
                </div>
              </div>

              <p className="pm-kicker mt-4">{displayCar.marca}</p>
              <p className="mt-1 font-display text-xl font-black text-tinta">
                {t("garage.modelHidden")}
              </p>
              <p className="pm-body mt-2">{t("garage.lockedCardDetailBody")}</p>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onStartRepesca?.();
                }}
                className="pm-btn mt-4"
              >
                {t("garage.lockedCardDetailCta")}
              </button>
            </div>
          ) : (
            /* Las dos caras están SIEMPRE montadas (si no, no hay volteo que
               animar), así que la que mira hacia atrás se marca aria-hidden y
               su botón sale del orden de tabulación: un lector de pantalla no
               debe leer el dorso mientras se ve la portada, ni el Tab llevar
               a un botón invisible. */
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
                  className="arch-cara arch-cara--portada px-4 pb-4 pt-1"
                  aria-hidden={flipped}
                >
                  <div className="border border-tinta">
                    <div className="flex items-center justify-between border-b border-border px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-muted">
                      <span>{t("garage.coverMasthead")}</span>
                      <span className="font-bold text-accent">
                        {t("garage.issueShort")} {issueLabel(displayCar.issue)}
                      </span>
                    </div>
                    {/* object-CONTAIN, no cover: en el detalle la foto se ve
                        ENTERA. Con cover, un coche fotografiado en panorámico
                        o en vertical perdía los extremos justo en la pantalla
                        donde el jugador viene a mirarlo de cerca. Las bandas
                        que deja el encaje son de papel: leen como el paspartú
                        de una foto montada, no como un hueco. En la rejilla se
                        mantiene cover, que es lo que da la cuadrícula regular
                        de un álbum. */}
                    <div className="arch-paspartu relative aspect-[4/3] w-full overflow-hidden">
                      <img
                        src={apiUrl(displayCar.img)}
                        alt={`${displayCar.marca} ${displayCar.modelo}`}
                        // Sin esto, arrastrar la foto con el ratón inicia el
                        // drag nativo de imagen y se come el gesto de volteo.
                        draggable={false}
                        className="h-full w-full object-contain"
                      />
                      {stamps.length > 0 && (
                        <span className="arch-sellos" style={{ top: 8 }}>
                          {stamps.map((m) => (
                            <span key={m} className={`arch-sello arch-sello--${m}`}>
                              {t(`garage.merit_${m}`)}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="pm-kicker mt-3">{displayCar.marca}</p>
                  <h3 className="mt-0.5 font-display text-[26px] font-black leading-none tracking-tight text-tinta">
                    {displayCar.modelo}
                  </h3>
                  <p className="mt-1 font-mono text-xs tabular-nums text-muted">
                    {displayCar.anio}
                    {displayCar.pais ? ` · ${getLocalizedCountry(displayCar.pais)}` : ""}
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
                    className="pm-btn pm-btn--ghost mt-4"
                  >
                    {t("garage.flipToBack")}
                  </button>
                  {/* El swipe es un gesto nuevo y no se descubre solo. Una
                      línea de pie basta: el botón de arriba ya cubre a quien
                      no lo lea. Solo en la portada — en el dorso ya lo sabe. */}
                  <p className="mt-1.5 text-center font-mono text-[9px] uppercase tracking-wider text-muted/70">
                    {t("garage.flipHint")}
                  </p>
                </div>

                {/* ── Cara: el dorso ── */}
                <div
                  ref={dorsoRef}
                  className="arch-cara arch-cara--dorso px-4 pb-4 pt-1"
                  aria-hidden={!flipped}
                >
                  <div className="flex items-center justify-between border-b border-border pb-1.5 font-mono text-[9px] uppercase tracking-wider text-muted">
                    <span>{displayCar.marca} · {displayCar.modelo}</span>
                    <span className="font-bold text-accent">
                      {t("garage.issueShort")} {issueLabel(displayCar.issue)}
                    </span>
                  </div>

                  <p className="pm-label mt-3">{t("garage.carSpec")}</p>
                  {getCarDescription(displayCar) ? (
                    <p className="pm-body mt-1">{getCarDescription(displayCar)}</p>
                  ) : (
                    <p className="pm-body mt-1 italic">{t("garage.carNoDescription")}</p>
                  )}

                  {/* TIRADA: cuánta gente tiene esta portada. Va ANTES de "en
                      tu archivo" porque es el dato que no depende de ti — el
                      que convierte un cromo en una pieza con valor. Se omite
                      entero si el servidor no publica rareza (muestra
                      insuficiente): mejor callar que inventar escasez. */}
                  {rarity && rarityPct !== null && (
                    <div className={`arch-tirada mt-4 t-${rarityKind}`}>
                      <p className="pm-label">{t("garage.rarityTitle")}</p>
                      <p className="etiqueta">{t(`garage.rarity_${rarityKind}`)}</p>
                      <p className="apoyo">
                        {t("garage.rarityBody", {
                          pct: rarityPct,
                          collectors,
                        })}
                      </p>
                    </div>
                  )}

                  <p className="pm-label arch-filete mt-4 pt-3">
                    {t("garage.backTitle")}
                  </p>
                  <div className="mt-1">
                    {wonAt && (
                      <div className="arch-dato">
                        <span className="k">{t("garage.datoWonAt")}</span>
                        <span className="v">{wonAt}</span>
                      </div>
                    )}
                    {/* Origen: de dónde salió la portada. Un cromo rescatado
                        de un número atrasado no se consiguió igual que uno
                        del día, y el dorso es donde eso se cuenta. */}
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
                        {/* El realce rojo marca el pleno, no el número: en la
                            repesca veterana solo hay un intento, así que
                            pintarlo de rojo celebraría una hazaña que no es. */}
                        <span
                          className={`v ${
                            displayCar.attempts === 1 && !displayCar.viaRepesca
                              ? "rojo"
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
                    className="pm-btn pm-btn--ghost mt-4"
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
// Modal de confirmación de Repesca Aleatoria
// ============================================================================
//
// Se abre tras pulsar el CTA de números atrasados y antes de tocar
// /api/repesca/start. Muestra las condiciones (una al día, mitad de puntos,
// no afecta racha) y nada de info del coche — porque ni siquiera nosotros
// sabemos cuál va a tocar todavía (lo sortea el servidor en el onAccept).
function RandomRepescaConfirm({ open, poolSize, starting, onCancel, onAccept }) {
  const { t } = useT();
  // Si está en pleno "Sorteando...", bloqueamos el cierre por backdrop: la
  // animación de salida confundiría (parecería cancelado cuando sigue el POST).
  return (
    <ModalShell
      open={open}
      onClose={onCancel}
      dismissOnBackdrop={!starting}
      label={t("garage.repescaConfirmTitle")}
      backdropClassName="modal-scrim fixed inset-0 z-[95] flex items-center justify-center p-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm overflow-hidden"
    >
        <div className="px-5 py-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center border border-accent text-accent">
            <DiceIcon className="h-7 w-7" />
          </div>
          <p className="pm-kicker mt-4">{t("garage.repescaTag")}</p>
          <h3 className="mt-1 font-display text-xl font-black tracking-tight text-tinta">
            {t("garage.repescaConfirmTitle")}
          </h3>

          <p className="pm-body mt-3">
            {t("garage.repescaConfirmBody", { poolSize })}
          </p>

          <div className="mt-4 border border-border px-3 py-1 text-left">
            <RuleRow icon={<CalendarIcon />}>{t("garage.repescaRuleOnePerDay")}</RuleRow>
            <RuleRow icon={<HalfIcon />}>{t("garage.repescaRuleHalfPoints")}</RuleRow>
            <RuleRow icon={<StreakSafeIcon />} last>{t("garage.repescaRuleNoStreak")}</RuleRow>
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={starting}
              className="pm-btn pm-btn--ghost flex-1"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={onAccept}
              disabled={starting}
              className="pm-btn flex-1"
              aria-busy={starting}
            >
              {starting ? t("garage.repescaStarting") : t("garage.repescaAccept")}
            </button>
          </div>
        </div>
    </ModalShell>
  );
}

// ============================================================================
// Subcomponentes auxiliares
// ============================================================================

// ── Iconos line-art (stroke currentColor, NO emoji — coherencia con el
// sistema de iconos de la app y cross-platform) ──────────────────────────
const GICO = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function CollectionIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...GICO} aria-hidden="true">
      <rect x="3" y="6" width="12" height="14" rx="1" />
      <path d="M8 6V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-1" />
    </svg>
  );
}

function DiceIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...GICO} aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <circle cx="8.5" cy="8.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CalendarIcon({ className = "h-[15px] w-[15px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...GICO} aria-hidden="true">
      <rect x="4" y="5" width="16" height="16" rx="1" />
      <path d="M4 9h16M8 3v4M16 3v4" />
    </svg>
  );
}

function HalfIcon({ className = "h-[15px] w-[15px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...GICO} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function StreakSafeIcon({ className = "h-[15px] w-[15px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...GICO} aria-hidden="true">
      <path d="M12 3l7 2.6v5.2c0 4.5-3 7.6-7 9.2-4-1.6-7-4.7-7-9.2V5.6z" />
      <path d="M9 12l2 2 4-4.2" />
    </svg>
  );
}

// Medalla de tier: bronce/plata/oro de una colección (país o marca).
function TierMedal({ tier, className = "h-4 w-4" }) {
  if (!tier) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      style={{ color: TIER_HEX[tier] }}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="14" r="6" fill={TIER_HEX[tier]} fillOpacity="0.18" />
      <path d="M9 9 6.5 3.5M15 9l2.5-5.5" />
      <circle cx="12" cy="14" r="6" />
    </svg>
  );
}

// Regla de la repesca como fila con icono (en vez de viñeta "·").
function RuleRow({ icon, children, last = false }) {
  return (
    <div
      className={`flex items-center gap-2.5 py-2 font-body text-xs text-muted ${
        last ? "" : "border-b border-border"
      }`}
    >
      <span className="shrink-0 text-accent">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function CenterMessage({ text, pulse = false, tone = "default", onRetry = null }) {
  const { t } = useT();
  // El error usa el rojo del sistema (`accent`), no un red-400 suelto fuera
  // de paleta: en una revista impresa solo hay una tinta roja.
  const toneClass = tone === "error" ? "text-accent" : "text-muted";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p
        className={`font-mono text-sm ${toneClass} ${
          pulse ? "animate-pulse uppercase tracking-widest" : ""
        }`}
      >
        {text}
      </p>
      {/* UNA SALIDA, no solo un diagnóstico. Sin este botón, el Archivo caído
          dejaba al jugador ante una línea roja y nada más: la única forma de
          volver a intentarlo era cerrar el panel y abrirlo otra vez, y eso hay
          que adivinarlo. Es el mismo remate que ya tienen la edición no
          disponible y el cupón sin catálogo — dos sitios donde este proyecto ya
          decidió que un fallo sin salida se lee como una app rota. */}
      {onRetry && (
        <button type="button" onClick={onRetry} className="pm-btn pm-btn--ghost !w-auto px-6 !py-2 !text-[11px]">
          {t("offline.retry")}
        </button>
      )}
    </div>
  );
}

// Modal con la explicación completa del modo Repesca. Lo lanza el link
// contextual bajo la banda de números atrasados. Se complementa con
// RandomRepescaConfirm, que es el modal corto justo antes de gastarla; este
// está pensado para consultarse ANTES de decidir.
function RepescaHelpModal({ open, onClose }) {
  const { t } = useT();
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={t("garage.repescaHelpTitle")}
      backdropClassName="modal-scrim fixed inset-0 z-[95] flex items-center justify-center p-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm overflow-hidden"
    >
        <div className="absolute right-2 top-2 z-10">
          <CloseButton onClick={onClose} />
        </div>

        <div className="px-5 pb-5 pt-6 text-left">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center border border-accent text-accent">
              <DiceIcon className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="pm-kicker">{t("garage.repescaHelpTag")}</p>
              <h3 className="font-display text-xl font-black tracking-tight text-tinta">
                {t("garage.repescaHelpTitle")}
              </h3>
            </div>
          </div>

          <p className="pm-body mt-4">{t("garage.repescaHelpBody")}</p>

          <div className="mt-4 space-y-2">
            <HelpRow icon={<DiceIcon className="h-4 w-4" />} title={t("garage.repescaHelpSurprise")}>
              {t("garage.repescaHelpSurpriseDesc")}
            </HelpRow>
            <HelpRow icon={<CalendarIcon className="h-4 w-4" />} title={t("garage.repescaHelpOnce")}>
              {t("garage.repescaHelpOnceDesc")}
            </HelpRow>
            <HelpRow icon={<HalfIcon className="h-4 w-4" />} title={t("garage.repescaHelpHalf")}>
              {t("garage.repescaHelpHalfDesc")}
            </HelpRow>
            <HelpRow
              icon={<AchievementIcon name="spark" size="h-4 w-4" />}
              title={t("garage.repescaHelpNoStreak")}
            >
              {t("garage.repescaHelpNoStreakDesc")}
            </HelpRow>
            <HelpRow icon={<AchievementIcon name="trophy" size="h-4 w-4" />} title={t("garage.repescaHelpVeteran")}>
              {t("garage.repescaHelpVeteranDesc")}
            </HelpRow>
          </div>

          <button type="button" onClick={onClose} className="pm-btn mt-5">
            {t("garage.repescaHelpOk")}
          </button>
        </div>
    </ModalShell>
  );
}

function HelpRow({ icon, title, children }) {
  return (
    <div className="flex gap-3 border border-border px-3 py-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center text-accent">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-tinta">
          {title}
        </p>
        <p className="pm-body mt-0.5 text-[13px]">{children}</p>
      </div>
    </div>
  );
}

function AuthWall({ onLogin }) {
  const { t } = useT();
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-5 border border-border bg-papel-mat p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center border border-accent">
          <LockIcon className="h-8 w-8 text-accent" />
        </div>
        <div>
          <p className="font-display text-xl font-black tracking-tight text-tinta">
            {t("garage.authTitle")}
          </p>
          <p className="pm-body mt-2">{t("garage.authBody")}</p>
        </div>
        {/* El botón de Google era `bg-papel … text-papel`: texto invisible
            sobre su propio fondo, herencia del tema oscuro donde `papel` era
            blanco sobre grafito. Ahora es el botón sólido del sistema. */}
        <button
          type="button"
          onClick={onLogin}
          className="pm-btn flex items-center justify-center gap-3"
        >
          <GoogleIcon className="h-4 w-4" />
          {t("common.continueWithGoogle")}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Icons
// ============================================================================

function LockIcon({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="9" rx="1" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function GoogleIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}
