// src/components/Garage.jsx
// Álbum de cromos con navegación de 3 niveles:
//   Vista 1 (Países)  → tarjetas con bandera de fondo.
//   Vista 2 (Marcas)  → tarjetas con logo de la marca dentro del país.
//   Vista 3 (Coches)  → cromos de la marca seleccionada (lona / desbloqueado).
//   Detail (overlay) → ficha completa al hacer click en un cromo.
//
// Estado: `selectedCountry` + `selectedBrand`. Si los dos son null → Vista 1;
// solo país → Vista 2; país + marca → Vista 3. ESC y BackButton siempre
// suben un nivel en la jerarquía.

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { supabase } from "../supabaseClient";
import { useEscape } from "../hooks/useEscape";
import { useScrollLock } from "../hooks/useScrollLock";
import { useT, getCarDescription, getLocalizedCountry } from "../i18n";
import { useToast } from "./Toast";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";
import AchievementIcon from "./AchievementIcons";
import RepescaDrawAnimation from "./RepescaDrawAnimation";
import { track } from "../lib/analytics";
import { flagImagePath } from "../data/countries";
import { countryTier, brandTier, collectorTier, TIER_HEX } from "../lib/collectionTier";

// Mapa de profundidad de cada vista del Garaje. Sirve para decidir la
// dirección del slide al cambiar de vista: bajar de nivel (countries →
// brands) → entra desde la derecha. Subir (brands → countries) → entra
// desde la izquierda. Mismo paradigma que la navegación nativa de iOS.
const VIEW_DEPTH = { countries: 0, brands: 1, cars: 2 };

// Variantes de slide. `dir` se pasa por `custom` a AnimatePresence — 1
// significa "navegamos hacia adelante" (más profundo), -1 "hacia atrás".
// La X de 40px es lo suficientemente sutil para no marear y suficientemente
// claro para que el ojo capte la dirección. La opacidad acompaña al
// movimiento para suavizar la entrada/salida.
const slideVariants = {
  enter: (dir) => ({ x: dir * 40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir) => ({ x: dir * -40, opacity: 0 }),
};

const slideTransition = {
  x: { type: "spring", stiffness: 320, damping: 32 },
  opacity: { duration: 0.18 },
};

// Slug de marca según especificación del usuario: simple lowercase + spaces→-.
// No quitamos acentos a propósito (es como el usuario nombra los .png).
function brandSlug(marca) {
  return String(marca || "").toLowerCase().replace(/\s+/g, "-");
}

function brandLogoPath(marca) {
  return `/brands/${brandSlug(marca)}.png`;
}

// Agrupa el array de coches de un país por marca, devolviendo una lista
// ordenada por progreso (desbloqueados desc) y luego alfabético.
function groupCarsByBrand(cars) {
  const map = new Map();
  for (const car of cars || []) {
    const m = car.marca || "Sin marca";
    if (!map.has(m)) map.set(m, { marca: m, cars: [] });
    map.get(m).cars.push(car);
  }
  return Array.from(map.values())
    .map((b) => ({
      ...b,
      unlocked: b.cars.filter((c) => c.unlocked).length,
      total: b.cars.length,
    }))
    .sort((a, b) => {
      if (b.unlocked !== a.unlocked) return b.unlocked - a.unlocked;
      return a.marca.localeCompare(b.marca, "es");
    });
}

export default function Garage({ open, onClose, user, onOpenLogin, onOpenAchievements }) {
  const { t } = useT();
  const toast = useToast();
  const [state, setState] = useState({
    loading: false,
    data: null,
    error: "",
  });
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [selectedBrand, setSelectedBrand] = useState(null);
  const [detailCar, setDetailCar] = useState(null);
  // Modal de confirmación de repesca aleatoria: se abre tras pulsar el CTA
  // y antes de tocar el backend, para que el usuario revise las reglas
  // (una al día, mitad de puntos, no afecta a la racha).
  const [confirmRepesca, setConfirmRepesca] = useState(false);
  // Modal "¿Cómo funciona la repesca?" (icono ? del header).
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

  // Bloquea el scroll del body mientras el modal Garage está abierto.
  // Garage no usa ModalShell (es un motion.div directo a body), así que
  // hay que llamar al hook a mano. Sus sub-modales (CarDetail,
  // ScoringHelp, RepescaHelp, RandomRepescaConfirm) sí usan ModalShell
  // y heredan el bloqueo desde ahí; el contador del hook impide que
  // cerrar un sub-modal libere el scroll mientras Garage sigue abierto.
  useScrollLock(open);

  // ESC: seis niveles encadenados, de más interno a más externo.
  useEscape(open && helpOpen, () => setHelpOpen(false));
  useEscape(open && !helpOpen && confirmRepesca, () => {
    if (!repescaStarting) setConfirmRepesca(false);
  });
  useEscape(
    open && !helpOpen && !confirmRepesca && Boolean(detailCar),
    () => setDetailCar(null)
  );
  useEscape(
    open && !helpOpen && !confirmRepesca && !detailCar && Boolean(selectedBrand),
    () => setSelectedBrand(null)
  );
  useEscape(
    open && !helpOpen && !confirmRepesca && !detailCar && !selectedBrand && Boolean(selectedCountry),
    () => setSelectedCountry(null)
  );
  useEscape(
    open && !helpOpen && !confirmRepesca && !detailCar && !selectedBrand && !selectedCountry,
    onClose
  );

  // Reset interno al cerrar.
  useEffect(() => {
    if (!open) {
      setSelectedCountry(null);
      setSelectedBrand(null);
      setDetailCar(null);
      setConfirmRepesca(false);
      setHelpOpen(false);
    }
  }, [open]);

  // Si cambia el país elegido, deselecciona la marca (que pertenecía al
  // país anterior).
  useEffect(() => {
    setSelectedBrand(null);
  }, [selectedCountry]);

  // Instrumentación: una vez por apertura (logueado o no — el anónimo rebota
  // al login, pero su apertura ES interés por la colección y queremos medirlo).
  // Sin esto estábamos a ciegas sobre cuánta gente abre el garaje, justo el
  // dato que decide si la colección merece su sitio.
  const trackedOpenRef = useRef(false);
  useEffect(() => {
    if (open && !trackedOpenRef.current) {
      trackedOpenRef.current = true;
      track("garage_open", { auth: user ? "user" : "anon" });
    } else if (!open) {
      trackedOpenRef.current = false;
    }
  }, [open, user]);

  // Fetch al abrir, solo logueado.
  useEffect(() => {
    if (!open || !user) return;

    setState({ loading: true, data: null, error: "" });

    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error(t("garage.errorNoSession"));

        const res = await fetch("/api/garage", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);

        setState({ loading: false, data: body, error: "" });
      } catch (err) {
        console.error("[Garage] fetch:", err);
        setState({
          loading: false,
          data: null,
          error: err?.message || t("garage.errorLoad"),
        });
      }
    })();
  }, [open, user]);

  // Resolución del país y la marca activos.
  const currentCountry =
    selectedCountry && state.data
      ? state.data.countries.find((c) => c.pais === selectedCountry) || null
      : null;

  // Agrupación cars→marca por país. Memoizado para no recalcular al
  // abrir un detail o cambiar de vista.
  const brandsInCountry = useMemo(() => {
    if (!currentCountry) return null;
    return groupCarsByBrand(currentCountry.cars);
  }, [currentCountry]);

  const currentBrand =
    selectedBrand && brandsInCountry
      ? brandsInCountry.find((b) => b.marca === selectedBrand) || null
      : null;

  // Tamaño de la pool de repesca: cuántos coches ya fueron daily y el
  // usuario aún no los ha ganado. Lo calcula el servidor en /api/garage
  // (`repescaPoolSize`) — antes lo derivábamos en cliente con `wasDaily`
  // por-coche, pero esa señal permitía un cheat pasivo (filtrar locked +
  // !wasDaily revelaba candidatos a coche-del-día). Ahora solo recibimos
  // el agregado. El servidor también es quien elige el coche concreto en
  // /api/repesca/start (CSPRNG), así que el cliente nunca necesita los ids.
  const repescaPoolSize = state.data?.repescaPoolSize ?? 0;

  // Click en el CTA "Repesca Aleatoria". Hace los pre-checks rápidos antes
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
      toast.push(err?.message || t("garage.errorRepescaFailed"), {
        type: "error",
      });
      setRepescaStarting(false);
      setDrawAnim(null);
    }
  }

  // ¿Qué vista estamos pintando?
  //   "countries" → Vista 1
  //   "brands"    → Vista 2 (país elegido, sin marca)
  //   "cars"      → Vista 3 (país + marca)
  const view = currentBrand ? "cars" : currentCountry ? "brands" : "countries";

  // Direccionalidad del slide: comparamos la profundidad de la vista actual
  // con la anterior. Si bajamos (countries → brands → cars), el nuevo
  // contenido entra desde la derecha. Si subimos (cars → brands → countries
  // o ESC), entra desde la izquierda. Esto da el "feel" nativo de iOS.
  // Hooks ANTES del early return para no romper el orden de React.
  const prevDepthRef = useRef(VIEW_DEPTH[view] ?? 0);
  const direction = (VIEW_DEPTH[view] ?? 0) >= prevDepthRef.current ? 1 : -1;
  useEffect(() => {
    prevDepthRef.current = VIEW_DEPTH[view] ?? 0;
  }, [view]);

  // Swipe-from-edge para volver al nivel anterior (estilo iOS):
  //   - El motion.div del panel acepta drag horizontal, pero `dragListener`
  //     está desactivado: el drag SOLO se inicia desde el edge handle,
  //     evitando interferir con scroll vertical, taps en cards o clicks en
  //     el header.
  //   - Threshold: 80 px de offset o 500 px/s de velocidad. El segundo es
  //     un "fling" rápido — confirma intención aunque la distancia sea corta.
  //   - dragConstraints right:200 limita cuánto puede arrastrarse, así no
  //     se ve el panel desplazado fuera del viewport.
  //   - dragElastic 0.15 da un toque de resistencia al final del rango.
  const dragControls = useDragControls();

  function handleSwipeEnd(_event, info) {
    const triggered = info.offset.x > 80 || info.velocity.x > 500;
    if (!triggered) return;
    if (view === "cars") {
      setSelectedBrand(null);
    } else if (view === "brands") {
      setSelectedCountry(null);
    } else {
      // En countries el swipe cierra el Garaje. Consistente con el ESC
      // encadenado: cuando ya no hay nivel al que subir, salimos del modal.
      onClose();
    }
  }

  // Nota: hemos quitado el `if (!open) return null` que había aquí. Con
  // AnimatePresence, el componente DEBE seguir renderizándose con open=false
  // para que la animación de salida pueda completarse antes del desmount.
  // El JSX final lo envuelve y solo monta el panel cuando open=true.

  // Datos del header (label + título) y back button según vista.
  let headerLabel = t("garage.headerCollection");
  let headerTitle = t("garage.headerTitle");
  let backLabel = null;
  let onBack = null;
  if (view === "brands") {
    headerLabel = t("garage.headerLabelCountry");
    headerTitle = getLocalizedCountry(currentCountry.pais);
    backLabel = t("garage.backCountries");
    onBack = () => setSelectedCountry(null);
  } else if (view === "cars") {
    headerLabel = t("garage.headerLabelBrand");
    headerTitle = currentBrand.marca;
    backLabel = getLocalizedCountry(currentCountry.pais);
    onBack = () => setSelectedBrand(null);
  }

  return (
    // AnimatePresence externo: el backdrop hace fade in/out (200 ms) y el
    // panel un slide-up con fade y un pizco de scale (~280 ms con spring).
    // El "feel" es el de un bottom-sheet móvil al subir, adaptado al panel
    // edge-to-edge alto del Garaje.
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
              border-x border-white/10 bg-[#0d1014] shadow-2xl
            "
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            // Drag horizontal armado pero NO autostart: el edge handle de
            // abajo es quien dispara dragControls.start(). Así el resto del
            // panel sigue siendo scrollable / clickable normal.
            // dragSnapToOrigin: tras soltar, el panel vuelve a x=0 SIEMPRE
            // (haya disparado swipe-back o no). Si dispara, el cambio de
            // vista lo anima la cadena de Fase A (slide direccional del
            // contenido interno); el panel mismo no se "va" del viewport,
            // así evitamos dos animaciones de slide compitiendo.
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
              con BackButton, cards, ni CloseButton). En cuanto el usuario
              hace pointer-down aquí, dragControls.start toma el control
              y empieza a seguir el dedo. Si el movimiento resulta vertical,
              Framer reconoce que no es un drag horizontal y lo descarta;
              touchAction: pan-y refuerza eso permitiendo scroll vertical
              nativo dentro de la zona del handle.
            */}
            <div
              aria-hidden="true"
              onPointerDown={(e) => dragControls.start(e)}
              className="absolute inset-y-0 left-0 z-30 w-4"
              style={{ touchAction: "pan-y" }}
            />

        {/* Header */}
        <div className="border-b border-white/10 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {backLabel && (
                <BackButton onClick={onBack} label={backLabel} />
              )}
              <p className={`text-[10px] uppercase tracking-[0.28em] text-accent ${backLabel ? "mt-2" : ""}`}>
                {headerLabel}
              </p>
              <h2 className="truncate font-display text-2xl tracking-widest text-white">
                {headerTitle}
              </h2>
            </div>
            <div className="flex items-center gap-1">
              {view === "countries" && (
                <button
                  type="button"
                  onClick={() => { onClose(); onOpenAchievements?.(); }}
                  aria-label={t("header.achievements")}
                  title={t("header.achievements")}
                  className="focus-ring flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-accent/15 hover:text-accent"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="8" r="5" />
                    <path d="M8.21 13.89 7 22l5-3 5 3-1.21-8.11" />
                  </svg>
                </button>
              )}
              <CloseButton onClick={onClose} />
            </div>
          </div>
        </div>

        {/* Body */}
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
          <CenterMessage text={state.error} tone="error" />
        ) : !state.data || state.data.countries.length === 0 ? (
          <CenterMessage text={t("garage.emptyCatalog")} />
        ) : (
          // AnimatePresence con mode="wait": espera a que la vista saliente
          // complete su exit antes de montar la entrante. Sin esto, ambas
          // se superpondrían visualmente durante ~200 ms. `custom` propaga
          // `direction` a las variantes para que sepan hacia dónde slidear.
          // `initial={false}`: la primera vez que se abre el modal, la vista
          // de countries aparece directamente sin slide entrante (estamos
          // recién montando, no es una navegación).
          // El overflow-hidden del motion.div corta el contenido cuando
          // entra/sale por los bordes, evitando ver el barrido fuera de la
          // columna del modal.
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={view}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={slideTransition}
              className="flex flex-1 flex-col overflow-hidden"
            >
              {view === "cars" ? (
                <BrandShowroom
                  country={currentCountry}
                  brand={currentBrand}
                  onSelectCar={setDetailCar}
                />
              ) : view === "brands" ? (
                <BrandsMenu
                  country={currentCountry}
                  brands={brandsInCountry}
                  onSelectBrand={setSelectedBrand}
                />
              ) : (
                <CountriesMenu
                  data={state.data}
                  onSelectCountry={setSelectedCountry}
                  repescaPoolSize={repescaPoolSize}
                  repescaAvailable={!!state.data?.repescaAvailable}
                  repescaActiveCarId={state.data?.repescaActiveCarId || null}
                  repescaStarting={repescaStarting}
                  onRandomRepesca={handleRandomRepesca}
                  onOpenHelp={() => setHelpOpen(true)}
                />
              )}
            </motion.div>
          </AnimatePresence>
        )}
          </motion.div>

          {/*
            Los sub-modales reciben siempre `open` (boolean) además de su data,
            y permanecen montados aunque open=false: así AnimatePresence
            (dentro de ModalShell) puede animar el exit antes de desmontarlos.
            Para CarDetail: cuando se cierra, `detailCar` queda
            momentáneamente en el state durante la animación de salida. Si
            el coche cambiara a null mientras aún se anima, intentaríamos
            leer car.marca de null → crash. Por eso conservamos el último
            valor en `displayCar` y lo pintamos hasta que la animación
            termina.
          */}
          <CarDetail
            open={Boolean(detailCar)}
            car={detailCar}
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
          del Garaje para que cubra toda la pantalla (z-[120]) y no quede
          recortado por el max-w-md del panel. Solo se monta cuando el
          usuario ha aceptado el sorteo y se desmonta cuando hay redirect
          (o si el POST falla y volvemos al estado inicial). */}
      {drawAnim && (
        <RepescaDrawAnimation
          veteran={drawAnim.veteran}
        />
      )}
    </AnimatePresence>
  );
}

// ============================================================================
// Vista 1: Menú de países
// ============================================================================

function CountriesMenu({
  data,
  onSelectCountry,
  repescaPoolSize,
  repescaAvailable,
  repescaActiveCarId,
  repescaStarting,
  onRandomRepesca,
  onOpenHelp,
}) {
  const { t, locale } = useT();
  const countries = data.countries || [];

  // Tier global de coleccionista + progreso, para el panel de estado. Mismo
  // cálculo que el carnet del Perfil (collectorTier): un único hilo de nivel.
  const tier = collectorTier(data.totalUnlocked);
  const tierLabel = tier.tier ? tier.label?.[locale] || tier.label?.es : null;
  const nextLabel = tier.next ? tier.next.label?.[locale] || tier.next.label?.es : null;
  const pct = data.totalCatalog
    ? Math.min(100, Math.round((data.totalUnlocked / data.totalCatalog) * 100))
    : 0;

  return (
    <>
      <div className="border-b border-white/10 bg-white/[0.02] px-4 py-3">
        {/* Panel de estado de colección: barra + tier global + siguiente nivel.
            Entrar al Garaje pasa a sentirse como abrir una vitrina, no como
            leer una cifra suelta. */}
        <div className="relative overflow-hidden rounded-xl border border-gold/20 bg-white/[0.03] px-3.5 py-3 text-left">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-white/85">
              <CollectionIcon className="h-4 w-4 text-gold" />
              {t("garage.collector")}
            </span>
            {tierLabel && (
              <span className="rounded-full border border-gold/35 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gold">
                {tierLabel}
              </span>
            )}
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full border border-white/5 bg-black/40">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="tabular-nums">
              <span className="font-semibold text-accent">{data.totalUnlocked}</span>
              <span className="text-muted"> / {data.totalCatalog} {t("garage.cars")}</span>
            </span>
            {nextLabel && (
              <span className="text-muted">{t("garage.nextTier")} · {nextLabel}</span>
            )}
          </div>
        </div>

        <div className="mt-3">
          <RandomRepescaButton
            poolSize={repescaPoolSize}
            available={repescaAvailable}
            hasActive={!!repescaActiveCarId}
            starting={repescaStarting}
            onClick={onRandomRepesca}
          />
          {/* Link contextual de ayuda: vive debajo del CTA en lugar de
              flotar junto al título del modal. Solo aparece en la vista
              raíz (countries), que es donde el modo Repesca tiene
              sentido. Al navegar a un país o marca, el link desaparece
              con el resto de la vista. */}
          <button
            type="button"
            onClick={onOpenHelp}
            className="
              mt-2 inline-flex items-center gap-1 text-[11px]
              text-muted/80 transition-colors duration-150
              hover:text-accent
            "
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2.5-3 4.5" />
              <path d="M12 18h.01" />
            </svg>
            {t("garage.helpRepesca")}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-2">
        <div className="flex flex-col">
          {countries.map((c) => (
            <CountryRow
              key={c.pais}
              country={c}
              onClick={() => onSelectCountry(c.pais)}
            />
          ))}
        </div>
      </div>
    </>
  );
}

// Fila de país (índice de álbum): la bandera se ve ENTERA en un chip, el
// progreso es una barra por país, y caben el doble en pantalla. La épica del
// banderón a pantalla completa se traslada a la cabecera del país al entrar.
function CountryRow({ country, onClick }) {
  const tier = countryTier(country.unlocked, country.total);
  const started = country.unlocked > 0;
  const pct = country.total
    ? Math.min(100, Math.round((country.unlocked / country.total) * 100))
    : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-3 border-b border-white/[0.06] px-1 py-2.5 text-left transition-colors hover:bg-white/[0.03] active:scale-[0.99] ${
        started ? "" : "opacity-60"
      }`}
    >
      <div className="h-[26px] w-9 shrink-0 overflow-hidden rounded-[5px] border border-white/15">
        <img
          src={flagImagePath(country.pais)}
          alt=""
          aria-hidden="true"
          draggable={false}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-[15px] font-semibold ${started ? "text-white" : "text-white/70"}`}>
            {getLocalizedCountry(country.pais)}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted">
            {country.unlocked} / {country.total}
          </span>
        </div>
        <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-white/[0.07]">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <TierMedalInline tier={tier} />
      <ChevronIcon className="h-4 w-4 shrink-0 text-white/30" />
    </button>
  );
}

// ============================================================================
// Vista 2: Menú de marcas dentro del país
// ============================================================================

function BrandsMenu({
  country,
  brands,
  onSelectBrand,
}) {
  const { t } = useT();
  const visibleBrands = brands || [];
  return (
    <>
      {/* Banda con bandera de fondo y progreso del país.
          - SIN `border-b` blanco: en oscuro renderiza como una línea
            "más clara" en el filo inferior.
          - Gradient terminado a opacidad 1 (mismo color que el fondo
            del modal `#0d1014`): así el corte con la zona inferior es
            invisible, en lugar de dejar pasar un 10% de la bandera
            (bordes blancos de Union Jack/Países Bajos delataban el corte). */}
      <div
        className="relative h-40"
        style={{
          backgroundImage: `linear-gradient(rgba(10,10,12,0.7), rgba(10,10,12,1)), url('${flagImagePath(country.pais)}')`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="relative flex h-full flex-col items-center justify-center px-4 text-center">
          <p
            className="font-display text-3xl font-bold uppercase tracking-widest text-white"
            style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}
          >
            {getLocalizedCountry(country.pais)}
          </p>
          <p className="mt-2 text-xs font-medium tabular-nums text-muted">
            {t("garage.countryCount", { unlocked: country.unlocked, total: country.total })}
          </p>
        </div>
      </div>

      {/* Índice de marcas: mismo idioma que la lista de países (emblema en
          chip + barra + progreso). El emblema real de /brands/*.png se ve
          nítido; si falta, cae a la inicial vía onError. */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-2">
        <div className="flex flex-col">
          {visibleBrands.map((brand) => (
            <BrandRow
              key={brand.marca}
              brand={brand}
              onClick={() => onSelectBrand(brand.marca)}
            />
          ))}
        </div>
      </div>
    </>
  );
}

// Fila de marca (índice): emblema real de la marca en un chip + barra +
// progreso. Si el .png falta o falla, cae a la inicial. Las marcas sin empezar
// (0/X) van atenuadas y en gris, para que el índice diga "empezada vs pendiente"
// de un vistazo.
function BrandRow({ brand, onClick }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const tier = brandTier(brand.unlocked, brand.total);
  const started = brand.unlocked > 0;
  const pct = brand.total
    ? Math.min(100, Math.round((brand.unlocked / brand.total) * 100))
    : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-3 border-b border-white/[0.06] px-1 py-2.5 text-left transition-colors hover:bg-white/[0.03] active:scale-[0.99] ${
        started ? "" : "opacity-60"
      }`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
        {logoFailed ? (
          <span className="text-sm font-bold text-white/70">
            {(brand.marca?.[0] || "?").toUpperCase()}
          </span>
        ) : (
          <img
            src={brandLogoPath(brand.marca)}
            alt=""
            aria-hidden="true"
            draggable={false}
            loading="lazy"
            onError={() => setLogoFailed(true)}
            className={`h-full w-full object-contain p-1 ${started ? "" : "opacity-40 grayscale"}`}
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-[15px] font-semibold ${started ? "text-white" : "text-white/70"}`}>
            {brand.marca}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted">
            {brand.unlocked} / {brand.total}
          </span>
        </div>
        <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-white/[0.07]">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <TierMedalInline tier={tier} />
      <ChevronIcon className="h-4 w-4 shrink-0 text-white/30" />
    </button>
  );
}

// ============================================================================
// Vista 3: Showroom de una marca
// ============================================================================

function BrandShowroom({
  country,
  brand,
  onSelectCar,
}) {
  const { t } = useT();
  const progressPct = brand.total
    ? Math.round((brand.unlocked / brand.total) * 100)
    : 0;
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Cabecera con logo de marca + barra de progreso. La bandera del país
          va de fondo, muy oscurecida, como guiño de contexto.
          Mismas precauciones que la Vista 2: sin border-b blanco y gradient
          terminado a opacidad 1 para fundir limpio con el bg del modal. */}
      <div
        className="relative px-4 py-5 text-center"
        style={{
          backgroundImage: `linear-gradient(rgba(10,10,12,0.78), rgba(10,10,12,1)), url('${flagImagePath(country.pais)}')`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="relative flex flex-col items-center">
          {!logoFailed ? (
            <img
              src={brandLogoPath(brand.marca)}
              alt={brand.marca}
              draggable={false}
              className="mb-2 h-12 w-auto object-contain"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <p
              className="font-display text-2xl font-bold uppercase tracking-widest text-white"
              style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}
            >
              {brand.marca}
            </p>
          )}
          <p className="mt-1 text-xs font-medium tabular-nums text-muted">
            {t("garage.brandCount", { unlocked: brand.unlocked, total: brand.total })}
          </p>
          <div className="mx-auto mt-3 h-1.5 w-32 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Grid de coches de la marca: 2 estados posibles
            A — Desbloqueado: foto a color, click → ficha
            B — Bloqueado: lona blureada + candado, no interactiva.
                La única forma de jugar un coche bloqueado es el botón
                "Repesca Aleatoria" del menú de países, que oculta marca,
                modelo e incluso a qué país pertenece. */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="grid grid-cols-2 gap-3 pb-3 sm:grid-cols-3">
          {brand.cars.map((car) =>
            car.unlocked ? (
              <UnlockedCard
                key={car.id}
                car={car}
                onClick={() => onSelectCar(car)}
              />
            ) : (
              <LockedCard
                key={car.id}
                car={car}
                onClick={() => onSelectCar({ ...car, locked: true })}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

function UnlockedCard({ car, onClick }) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        group relative aspect-[4/5] w-full overflow-hidden rounded-lg
        border border-accent/40 bg-bg-secondary
        shadow-md shadow-black/40 transition
        hover:border-accent hover:shadow-accent/20
        active:scale-[0.97]
      "
    >
      <div className="absolute inset-0 overflow-hidden">
        <img
          src={car.img}
          alt={`${car.marca} ${car.modelo}`}
          draggable={false}
          loading="lazy"
          className="h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
        />
      </div>

      {/* Gradient elegante de abajo hacia arriba */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black via-black/60 to-transparent" />

      {/* Etiqueta con jerarquía: marca pequeña amarilla, modelo blanco bold */}
      <div className="absolute inset-x-0 bottom-0 p-2.5 text-left">
        <p className="truncate text-xs font-medium uppercase tracking-widest text-accent">
          {car.marca}
        </p>
        <p className="truncate text-sm font-bold text-white">
          {car.modelo}
        </p>
        <p className="text-[10px] tabular-nums text-muted">{car.anio}</p>
      </div>

      <div className="absolute right-1.5 top-1.5 rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-accent">
        ✓
      </div>

      {/* Insignia Modo Veterano: solo aparece cuando el cromo se ganó tras
          haberlo fallado antes (1 intento sin pistas). Discreto pero
          reconocible — premia el completismo "duro". */}
      {car.wonAsVeteran && (
        <div
          className="
            absolute left-1.5 top-1.5 rounded-full border border-amber-300/60
            bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase
            tracking-widest text-amber-200
          "
          title={t("garage.veteranBadgeAria")}
          aria-label={t("garage.veteranBadgeAria")}
        >
          {t("garage.veteranBadgeShort")}
        </div>
      )}
    </button>
  );
}

function LockedCard({ car, onClick }) {
  const { t } = useT();
  // El blur va aplicado SERVER-SIDE en /api/car-image (mode=blurred): lo que
  // llega al navegador es un JPEG ya desenfocado y oscurecido. No usamos
  // CSS blur a propósito — sería trivial de quitar abriendo DevTools y leyendo
  // la `src` original (que en este flujo, además, nunca existe en el cliente).
  // El overlay CSS que sí ponemos es decorativo, no de seguridad.
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        group relative aspect-[4/5] w-full overflow-hidden rounded-lg
        border border-white/10 bg-[#0d0d10]
        shadow-md shadow-black/40 transition-all duration-300
        hover:border-amber-500/30 hover:scale-[1.02]
        active:scale-[0.98] cursor-pointer
      "
      aria-label={t("garage.ariaLockedCard")}
    >
      <img
        src={car?.img}
        alt=""
        aria-hidden="true"
        draggable={false}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/80 to-black/40" />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2 text-center">
        <LockIcon className="h-7 w-7 text-amber-500/70 transition-transform duration-300 group-hover:scale-110" />
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-500/80 transition-colors duration-300 group-hover:text-amber-400"
          style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
        >
          {t("garage.lockedLabel")}
        </p>
      </div>
    </button>
  );
}

// ============================================================================
// Detail del cromo
// ============================================================================

function CarDetail({ open, car, onClose, onStartRepesca }) {
  const { t } = useT();
  // Conservamos el último coche válido en estado local. Cuando el padre
  // hace setDetailCar(null) para cerrar el modal, `car` pasa a null y `open`
  // a false en el mismo render — pero el exit-animation tarda ~250 ms en
  // completarse. Sin esta cache, durante ese intervalo intentaríamos leer
  // car.marca de null y reventaría. displayCar solo se actualiza con
  // valores no-null, así que sobrevive a la animación de salida.
  const [displayCar, setDisplayCar] = useState(car);
  useEffect(() => {
    if (car) setDisplayCar(car);
  }, [car]);

  const isLocked = displayCar?.locked;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      backdropClassName="modal-scrim fixed inset-0 z-[95] flex items-center justify-center p-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm overflow-hidden ring-1 ring-accent/40"
    >
      {displayCar && (
        <>
          <div className="absolute right-2 top-2 z-10">
            <CloseButton onClick={onClose} />
          </div>

          <div className="relative aspect-[4/3] w-full overflow-hidden bg-bg-secondary">
            <img
              src={displayCar.img}
              alt={isLocked ? t("garage.ariaLockedCard") : `${displayCar.marca} ${displayCar.modelo}`}
              className="h-full w-full object-cover"
            />
            {isLocked && (
              <>
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/85 to-black/40" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2 text-center">
                  <LockIcon className="h-9 w-9 text-amber-500/70 animate-pulse" />
                  <p
                    className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-500/80"
                    style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
                  >
                    {t("garage.lockedLabel")}
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="p-4">
            <p className="text-xs font-medium uppercase tracking-widest text-accent">
              {displayCar.marca}
            </p>

            {isLocked ? (
              <>
                <div className="mt-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-gold/30 bg-gold/[0.06] px-2.5 py-1 text-xs font-medium text-gold/90">
                    <LockIcon className="h-3.5 w-3.5" />
                    {t("garage.modelHidden")}
                  </span>
                </div>
                <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3 text-left">
                  <p className="mb-1 text-[10px] uppercase tracking-[0.22em] text-accent">
                    {t("garage.repescaTag")}
                  </p>
                  <p className="text-sm leading-relaxed text-white/90">
                    {t("garage.lockedCardDetailBody")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onStartRepesca?.();
                  }}
                  className="
                    mt-4 w-full rounded-lg bg-accent px-4 py-2.5
                    text-xs font-semibold uppercase tracking-[0.12em] text-bg-primary
                    transition hover:brightness-110 active:scale-[0.98]
                  "
                >
                  {t("garage.lockedCardDetailCta")}
                </button>
              </>
            ) : (
              <>
                <h3 className="mt-0.5 font-display text-2xl font-bold tracking-wider text-white">
                  {displayCar.modelo}
                </h3>
                <p className="mt-0.5 font-display text-base tabular-nums text-muted">
                  {displayCar.anio}
                </p>

                {getCarDescription(displayCar) ? (
                  <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3 text-left">
                    <p className="mb-1 text-[10px] uppercase tracking-[0.22em] text-accent">
                      {t("garage.carSpec")}
                    </p>
                    <p className="text-sm leading-relaxed text-white/90">
                      {getCarDescription(displayCar)}
                    </p>
                  </div>
                ) : (
                  <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-3 text-xs italic text-muted">
                    {t("garage.carNoDescription")}
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
    </ModalShell>
  );
}

// ============================================================================
// Modal de confirmación de Repesca Aleatoria
// ============================================================================
//
// Se abre tras pulsar el CTA principal y antes de tocar /api/repesca/start.
// Muestra las condiciones (una al día, mitad de puntos, no afecta racha)
// y nada de info del coche — porque ni siquiera nosotros sabemos cuál nos
// va a tocar todavía (el random sale en el `onAccept`).
function RandomRepescaConfirm({ open, poolSize, starting, onCancel, onAccept }) {
  const { t } = useT();
  // Si está en pleno proceso de "Sorteando..." (starting=true), bloqueamos
  // que se cierre tocando el backdrop. La animación de salida del modal
  // confundiría: parecería que se cancela cuando en realidad sigue el POST.
  return (
    <ModalShell
      open={open}
      onClose={onCancel}
      dismissOnBackdrop={!starting}
      backdropClassName="modal-scrim fixed inset-0 z-[95] flex items-center justify-center p-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm overflow-hidden ring-1 ring-accent/40"
    >
        <div className="px-5 py-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-accent">
            <DiceIcon className="h-7 w-7" />
          </div>
          <p className="mt-4 text-[10px] uppercase tracking-[0.28em] text-accent">
            {t("garage.repescaTag")}
          </p>
          <h3 className="mt-1 font-display text-xl tracking-wider text-white">
            {t("garage.repescaConfirmTitle")}
          </h3>

          <p className="mt-3 text-sm text-muted">
            {t("garage.repescaConfirmBody", { poolSize })}
          </p>

          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1 text-left">
            <RuleRow icon={<CalendarIcon />}>{t("garage.repescaRuleOnePerDay")}</RuleRow>
            <RuleRow icon={<HalfIcon />}>{t("garage.repescaRuleHalfPoints")}</RuleRow>
            <RuleRow icon={<StreakSafeIcon />} last>{t("garage.repescaRuleNoStreak")}</RuleRow>
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={starting}
              className="
                flex-1 rounded-lg border border-white/10 bg-white/[0.04]
                px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-white/80
                transition hover:border-white/30 hover:text-white
                disabled:cursor-not-allowed disabled:opacity-50
              "
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={onAccept}
              disabled={starting}
              className="
                flex-1 rounded-lg bg-accent
                px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-bg-primary
                transition hover:brightness-110
                disabled:cursor-not-allowed disabled:opacity-60
              "
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
// Botón "Repesca Aleatoria" (CTA principal del Garaje)
// ============================================================================
//
// Sustituye al flujo antiguo de "elegir coche bloqueado + confirmar". Ahora el
// usuario no ve ni marca ni país del coche que va a jugar: el servidor
// (vía /api/repesca/start) consume el intento del día y la página /repesca
// muestra solo la lona blureada hasta que se hace el primer intento.
//
// Estados visuales:
//   - hasActive  → "Continuar repesca": ya hay una partida en curso hoy.
//   - !available → "Sin repescas hoy" : ya consumió su intento, pero la
//                   partida está terminada (ganada o perdida). Botón
//                   desactivado.
//   - poolSize=0 → "Álbum completo"   : no quedan coches pendientes.
//                   Botón desactivado.
//   - default    → icono de dado + "Jugar Repesca Aleatoria".
function RandomRepescaButton({
  poolSize,
  available,
  hasActive,
  starting,
  onClick,
}) {
  const { t } = useT();
  let label;
  let Icon = DiceIcon;
  let disabled = false;
  let tone = "accent";

  if (starting) {
    label = t("garage.repescaStarting");
    Icon = DiceIcon;
  } else if (hasActive) {
    label = t("garage.repescaContinue");
    Icon = RefreshIcon;
  } else if (poolSize === 0) {
    label = t("garage.repescaComplete");
    Icon = StarIcon;
    disabled = true;
    tone = "muted";
  } else if (!available) {
    label = t("garage.repescaNoneToday");
    Icon = HourglassIcon;
    disabled = true;
    tone = "muted";
  } else {
    label = t("garage.repescaPlay");
  }

  const base =
    "inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 " +
    "text-xs font-semibold uppercase tracking-[0.16em] transition-all active:scale-[0.98] " +
    "disabled:cursor-not-allowed disabled:opacity-60";
  const toneCls =
    tone === "accent"
      ? "border border-accent/50 bg-accent/15 text-accent hover:border-accent hover:bg-accent/25"
      : "border border-white/10 bg-white/[0.04] text-white/60";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || starting}
      aria-busy={starting}
      className={`${base} ${toneCls}`}
    >
      <Icon className="h-[18px] w-[18px]" />
      <span>{label}</span>
      {!disabled && !starting && poolSize > 0 && !hasActive && (
        <span className="ml-1 rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] tabular-nums tracking-wider text-accent">
          {poolSize}
        </span>
      )}
    </button>
  );
}

// ============================================================================
// Subcomponentes auxiliares
// ============================================================================

// ── Iconos line-art del Garaje (stroke currentColor, NO emoji — coherencia
// con el sistema de iconos de la app y cross-platform) ───────────────────
const GICO = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function ChevronIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...GICO} strokeWidth="2" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function CollectionIcon({ className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...GICO} aria-hidden="true">
      <rect x="3" y="6" width="12" height="14" rx="2" />
      <path d="M8 6V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-1" />
    </svg>
  );
}

function DiceIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...GICO} aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <circle cx="8.5" cy="8.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

function RefreshIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...GICO} aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-1.6 5.2" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}

function StarIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...GICO} aria-hidden="true">
      <path d="M12 3.5l2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.65l5.9-.85z" />
    </svg>
  );
}

function HourglassIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...GICO} aria-hidden="true">
      <path d="M6 3h12M6 21h12" />
      <path d="M7 3v3.2c0 1.8 5 3 5 5.8s-5 4-5 5.8V21" />
      <path d="M17 3v3.2c0 1.8-5 3-5 5.8" />
    </svg>
  );
}

function CalendarIcon({ className = "h-[15px] w-[15px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...GICO} aria-hidden="true">
      <rect x="4" y="5" width="16" height="16" rx="2" />
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

// Medalla de tier inline (filas del índice). Slot de ancho fijo para que el
// chevron quede alineado, haya medalla o no.
function TierMedalInline({ tier }) {
  return (
    <span className="flex w-4 shrink-0 justify-center" aria-hidden="true">
      {tier ? (
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          style={{ color: TIER_HEX[tier] }}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="14" r="6" fill={TIER_HEX[tier]} fillOpacity="0.18" />
          <path d="M9 9 6.5 3.5M15 9l2.5-5.5" />
          <circle cx="12" cy="14" r="6" />
        </svg>
      ) : null}
    </span>
  );
}

// Regla de la repesca como fila con icono (en vez de viñeta "·").
function RuleRow({ icon, children, last = false }) {
  return (
    <div
      className={`flex items-center gap-2.5 py-2 text-xs text-muted ${
        last ? "" : "border-b border-white/[0.06]"
      }`}
    >
      <span className="shrink-0 text-accent">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function BackButton({ onClick, label }) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("garage.backTo", { label })}
      className="
        inline-flex max-w-full items-center gap-1.5
        rounded-md border border-white/10 bg-white/[0.04]
        px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-white/80
        transition hover:border-accent/60 hover:bg-accent/10 hover:text-accent
        active:scale-95
      "
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
      <span className="truncate">{t("garage.backTo", { label })}</span>
    </button>
  );
}

function CenterMessage({ text, pulse = false, tone = "default" }) {
  const toneClass = tone === "error" ? "text-red-400" : "text-muted";
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center">
      <p className={`text-sm ${toneClass} ${pulse ? "animate-pulse uppercase tracking-widest" : ""}`}>
        {text}
      </p>
    </div>
  );
}

// Modal con la explicación completa del modo Repesca. Lo lanza el link
// contextual "Cómo funciona la repesca" debajo del CTA de la vista raíz.
// Se complementa con RandomRepescaConfirm, que es el modal corto
// que sale justo antes de gastar la repesca; este de aquí está pensado
// para consultarse antes de decidir.
function RepescaHelpModal({ open, onClose }) {
  const { t } = useT();
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      backdropClassName="modal-scrim fixed inset-0 z-[95] flex items-center justify-center p-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm overflow-hidden ring-1 ring-accent/40"
    >
        <div className="absolute right-2 top-2 z-10">
          <CloseButton onClick={onClose} />
        </div>

        <div className="px-5 pb-5 pt-6 text-left">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-accent">
              <DiceIcon className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.28em] text-accent">
                {t("garage.repescaHelpTag")}
              </p>
              <h3 className="font-display text-xl tracking-wider text-white">
                {t("garage.repescaHelpTitle")}
              </h3>
            </div>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-white/90">
            {t("garage.repescaHelpBody")}
          </p>

          <div className="mt-4 space-y-3">
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

          <button
            type="button"
            onClick={onClose}
            className="
              mt-5 w-full rounded-lg border border-accent/50 bg-accent/15
              px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-accent
              transition hover:border-accent hover:bg-accent/25 active:scale-[0.98]
            "
          >
            {t("garage.repescaHelpOk")}
          </button>
        </div>
    </ModalShell>
  );
}

function HelpRow({ icon, title, children }) {
  return (
    <div className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 font-display text-sm text-accent">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
          {title}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{children}</p>
      </div>
    </div>
  );
}

function AuthWall({ onLogin }) {
  const { t } = useT();
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border border-white/10 bg-bg-secondary/60 p-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full border border-accent/40 bg-accent/10">
          <LockIcon className="h-9 w-9 text-accent" />
        </div>
        <div>
          <p className="font-display text-xl tracking-widest text-white">
            {t("garage.authTitle")}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {t("garage.authBody")}
          </p>
        </div>
        <button
          type="button"
          onClick={onLogin}
          className="
            flex w-full items-center justify-center gap-3
            rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black
            transition-transform hover:scale-[1.02] active:scale-[0.98]
          "
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
      <rect x="4" y="11" width="16" height="9" rx="2" />
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
