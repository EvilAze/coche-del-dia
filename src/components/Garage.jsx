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
import { useT, getCarDescription, getLocalizedCountry } from "../i18n";
import { useToast } from "./Toast";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";

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

function slugifyCountry(pais) {
  return String(pais || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\./g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
}

function flagImagePath(pais) {
  return `/flags/${slugifyCountry(pais)}.jpg`;
}

// Slug de marca según especificación del usuario: simple lowercase + spaces→-.
// No quitamos acentos a propósito (es como el usuario nombra los .png).
function brandSlug(marca) {
  return String(marca || "").toLowerCase().replace(/\s+/g, "-");
}

function brandLogoPath(marca) {
  return `/brands/${brandSlug(marca)}.png`;
}

// Cuenta coches "missed" en un array: ya fue coche del día y el usuario
// no lo ha ganado. Es la cifra que muestra el indicador ámbar y la que
// usa el filtro "Solo pendientes" para decidir qué tarjetas aparecen.
function countMissed(cars) {
  let n = 0;
  for (const c of cars || []) {
    if (!c.unlocked && c.wasDaily) n++;
  }
  return n;
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
      missed: countMissed(b.cars),
    }))
    .sort((a, b) => {
      if (b.unlocked !== a.unlocked) return b.unlocked - a.unlocked;
      return a.marca.localeCompare(b.marca, "es");
    });
}

export default function Garage({ open, onClose, user, onOpenLogin }) {
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

  // Pool global de coches "pasados y pendientes": todos los coches que YA
  // fueron coche del día (wasDaily) y que el usuario AÚN no ha adivinado
  // (no unlocked). Los ids son pseudo-ids opacos generados por /api/garage,
  // lo cual es lo que queremos: el cliente nunca conoce la marca/modelo del
  // coche que va a tocar hasta que empieza la partida.
  const repescaPool = useMemo(() => {
    if (!state.data?.countries) return [];
    const ids = [];
    for (const c of state.data.countries) {
      for (const car of c.cars || []) {
        if (car.wasDaily && !car.unlocked) ids.push(car.id);
      }
    }
    return ids;
  }, [state.data]);

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

    if (repescaPool.length === 0) {
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

  // El usuario acepta la repesca tras leer las condiciones. Sorteamos un
  // coche al azar de la pool de pendientes y delegamos en el backend la
  // consumición del intento. Tras OK, redirect a /repesca?id=<pseudo>.
  async function confirmAndStartRepesca() {
    if (repescaStarting) return;
    if (repescaPool.length === 0) {
      // Defensivo: la pool pudo cambiar entre apertura y aceptación.
      setConfirmRepesca(false);
      return;
    }

    const pickedId = repescaPool[Math.floor(Math.random() * repescaPool.length)];

    setRepescaStarting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error(t("garage.errorNoSession"));

      const res = await fetch("/api/repesca/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ carId: pickedId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
      }
      window.location.href = `/repesca?id=${encodeURIComponent(pickedId)}`;
    } catch (err) {
      console.error("[Garage] random repesca:", err);
      toast.push(err?.message || t("garage.errorRepescaFailed"), {
        type: "error",
      });
      setRepescaStarting(false);
      setConfirmRepesca(false);
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
          className="fixed inset-0 z-[85] flex items-stretch justify-center bg-black/85 backdrop-blur-sm"
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
              border-x border-white/10 bg-[#0a0a0c] shadow-2xl
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
            <div className="min-w-0">
              {backLabel && (
                <BackButton onClick={onBack} label={backLabel} />
              )}
              <p className={`text-[10px] uppercase tracking-[0.28em] text-accent ${backLabel ? "mt-2" : ""}`}>
                {headerLabel}
              </p>
              <div className="flex items-center gap-2.5">
                <h2 className="truncate font-display text-2xl tracking-widest text-white">
                  {headerTitle}
                </h2>
                <HelpButton onClick={() => setHelpOpen(true)} />
              </div>
            </div>
            <CloseButton onClick={onClose} />
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
                  repescaPoolSize={repescaPool.length}
                  repescaAvailable={!!state.data?.repescaAvailable}
                  repescaActiveCarId={state.data?.repescaActiveCarId || null}
                  repescaStarting={repescaStarting}
                  onRandomRepesca={handleRandomRepesca}
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
          />

          <RandomRepescaConfirm
            open={confirmRepesca}
            poolSize={repescaPool.length}
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
}) {
  const { t } = useT();
  // Decoramos cada país con su `missed` (no `unlocked` && wasDaily) para
  // que CountryCard pueda mostrar el contador ámbar.
  const countriesWithMissed = useMemo(() => {
    return (data.countries || []).map((c) => ({
      ...c,
      missed: countMissed(c.cars),
    }));
  }, [data.countries]);

  return (
    <>
      <div className="border-b border-white/10 bg-white/[0.02] px-4 py-2.5 text-center">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted">
          {t("garage.progressTotal")}
        </p>
        <p className="mt-0.5 font-display text-lg text-white">
          <span className="text-accent">{data.totalUnlocked}</span>
          <span className="text-muted"> / {data.totalCatalog}</span>
        </p>

        <div className="mt-3">
          <RandomRepescaButton
            poolSize={repescaPoolSize}
            available={repescaAvailable}
            hasActive={!!repescaActiveCarId}
            starting={repescaStarting}
            onClick={onRandomRepesca}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {countriesWithMissed.map((c) => (
            <CountryCard
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

function CountryCard({ country, onClick }) {
  const { t } = useT();
  const completed = country.unlocked === country.total && country.total > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="
        group relative aspect-square w-full overflow-hidden rounded-xl
        border border-gray-800 bg-[#1a1a20] shadow-md shadow-black/40
        transition-transform duration-200
        hover:scale-105 hover:border-accent/60
        active:scale-[0.97]
      "
      style={{
        backgroundImage: `linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.55) 55%, transparent 100%), url('${flagImagePath(country.pais)}')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {completed && (
        <div className="absolute left-2 top-2 rounded-full bg-accent/25 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-accent backdrop-blur-sm">
          {t("garage.badgeComplete")}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 px-3 pb-3 pt-6 text-center">
        <p
          className="font-display text-lg font-bold uppercase tracking-wider text-white sm:text-xl"
          style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}
        >
          {getLocalizedCountry(country.pais)}
        </p>
        <p className="mt-1 text-xs font-medium tabular-nums text-gray-300">
          {country.unlocked} / {country.total}
        </p>
      </div>
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
            del modal `#0a0a0c`): así el corte con la zona inferior es
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
        <div className="absolute inset-0 backdrop-blur-sm" />
        <div className="relative flex h-full flex-col items-center justify-center px-4 text-center">
          <p
            className="font-display text-3xl font-bold uppercase tracking-widest text-white"
            style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}
          >
            {getLocalizedCountry(country.pais)}
          </p>
          <p className="mt-2 text-xs font-medium tabular-nums text-gray-300">
            {t("garage.countryCount", { unlocked: country.unlocked, total: country.total })}
          </p>
        </div>
      </div>

      {/* Grid de marcas. Forzado a 2 columnas siempre: el modal queda
          a max-w-md (448px) y 3 columnas dejan cada card ~130px, que
          no da para acomodar nombres largos (VOLKSWAGEN, MERCEDES-BENZ)
          con tipografía premium y tracking ancho. */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          {visibleBrands.map((brand) => (
            <BrandCard
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

function BrandCard({ brand, onClick }) {
  // Vista 2 — Ghost Logo (marca de agua): el nombre en tipografía noble
  // sigue siendo el protagonista, pero el logo de la marca aparece detrás
  // como textura casi imperceptible. Al hover el logo crece y sube su
  // opacidad, dando la sensación de que la card "respira".
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        group relative flex min-h-[120px] w-full flex-col items-center justify-center
        overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900
        p-6 text-center transition-colors
        hover:border-neutral-500
        active:scale-[0.97]
      "
    >
      {/* Ghost logo de fondo: posición absoluta cubriendo toda la card,
          desaturado y casi transparente. Al pasar por encima crece y se
          intensifica un pelín. `pointer-events-none` para que el click
          siga golpeando al botón, no a la <img>. Si el .png no existe el
          onError la oculta y la card queda solo con el fondo neutro. */}
      <img
        src={brandLogoPath(brand.marca)}
        alt=""
        aria-hidden="true"
        draggable={false}
        loading="lazy"
        className="
          pointer-events-none absolute inset-0 h-full w-full
          scale-110 object-contain p-2 opacity-10 grayscale
          transition-all duration-500
          group-hover:scale-125 group-hover:opacity-20
        "
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />

      {/* Contenido de primer plano: relative + z-10 para apilarse sobre el
          ghost logo. `drop-shadow-md` da algo de cuerpo al texto sin perder
          el look minimalista. */}
      <div className="relative z-10 flex flex-col items-center">
        <p
          className="
            w-full break-words text-center font-bold uppercase text-neutral-200
            text-base sm:text-lg
            tracking-[0.1em] sm:tracking-[0.18em]
            drop-shadow-md
          "
        >
          {brand.marca}
        </p>

        {/* Línea separadora sutil entre el nombre y el contador */}
        <div className="mt-3 h-px w-10 bg-neutral-700" aria-hidden="true" />

        <p className="mt-3 text-sm font-medium tabular-nums text-neutral-500 drop-shadow-md">
          {brand.unlocked} / {brand.total}
        </p>
      </div>
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
        <div className="absolute inset-0 backdrop-blur-sm" />
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
          <p className="mt-1 text-xs font-medium tabular-nums text-gray-300">
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
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-2 gap-3 pb-3 sm:grid-cols-3">
          {brand.cars.map((car) =>
            car.unlocked ? (
              <UnlockedCard
                key={car.id}
                car={car}
                onClick={() => onSelectCar(car)}
              />
            ) : (
              <LockedCard key={car.id} car={car} />
            )
          )}
        </div>
      </div>
    </div>
  );
}

function UnlockedCard({ car, onClick }) {
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
        <p className="truncate text-xs font-medium uppercase tracking-widest text-yellow-500">
          {car.marca}
        </p>
        <p className="truncate text-sm font-bold text-white">
          {car.modelo}
        </p>
        <p className="text-[10px] tabular-nums text-gray-400">{car.anio}</p>
      </div>

      <div className="absolute right-1.5 top-1.5 rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-accent backdrop-blur-sm">
        ✓
      </div>
    </button>
  );
}

function LockedCard({ car }) {
  const { t } = useT();
  // El blur va aplicado SERVER-SIDE en /api/car-image (mode=blurred): lo que
  // llega al navegador es un JPEG ya desenfocado y oscurecido. No usamos
  // CSS blur a propósito — sería trivial de quitar abriendo DevTools y leyendo
  // la `src` original (que en este flujo, además, nunca existe en el cliente).
  // El overlay CSS que sí ponemos es decorativo, no de seguridad.
  //
  // Las tarjetas bloqueadas son puramente visuales: ya NO permiten iniciar
  // una repesca individualmente. El usuario juega coches bloqueados solo
  // a través del botón "Repesca Aleatoria" del menú de países, que esconde
  // toda pista sobre marca / modelo / país hasta empezar la partida.
  return (
    <div
      className="
        relative aspect-[4/5] w-full overflow-hidden rounded-lg
        border border-white/10 bg-[#0d0d10]
        shadow-md shadow-black/40
      "
      aria-label={t("garage.ariaLockedCard")}
    >
      <img
        src={car?.img}
        alt=""
        aria-hidden="true"
        draggable={false}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover object-center"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/80 to-black/40" />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2 text-center">
        <LockIcon className="h-7 w-7 text-amber-500/70" />
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-500/80"
          style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
        >
          {t("garage.lockedLabel")}
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Detail del cromo
// ============================================================================

function CarDetail({ open, car, onClose }) {
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

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      backdropClassName="fixed inset-0 z-[95] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      panelClassName="relative w-full max-w-sm overflow-hidden rounded-2xl border border-accent/30 bg-[#0a0a0c] shadow-2xl"
    >
      {displayCar && (
        <>
          <div className="absolute right-2 top-2 z-10">
            <CloseButton onClick={onClose} />
          </div>

          <div className="aspect-[4/3] w-full overflow-hidden bg-bg-secondary">
            <img
              src={displayCar.img}
              alt={`${displayCar.marca} ${displayCar.modelo}`}
              className="h-full w-full object-cover"
            />
          </div>

          <div className="p-4">
            <p className="text-xs font-medium uppercase tracking-widest text-yellow-500">
              {displayCar.marca}
            </p>
            <h3 className="mt-0.5 font-display text-2xl font-bold tracking-wider text-white">
              {displayCar.modelo}
            </h3>
            <p className="mt-0.5 font-display text-base tabular-nums text-gray-400">
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
      backdropClassName="fixed inset-0 z-[95] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      panelClassName="relative w-full max-w-sm overflow-hidden rounded-2xl border border-accent/40 bg-[#0a0a0c] shadow-2xl"
    >
        <div className="px-5 py-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-accent/40 bg-accent/10">
            <span className="text-2xl" aria-hidden="true">🎲</span>
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

          <ul className="mt-4 space-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3 text-left text-xs text-muted">
            <li>· {t("garage.repescaRuleOnePerDay")}</li>
            <li>· {t("garage.repescaRuleHalfPoints")}</li>
            <li>· {t("garage.repescaRuleNoStreak")}</li>
          </ul>

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
//   - default    → "🎲 Jugar Repesca Aleatoria".
function RandomRepescaButton({
  poolSize,
  available,
  hasActive,
  starting,
  onClick,
}) {
  const { t } = useT();
  let label;
  let icon = "🎲";
  let disabled = false;
  let tone = "accent";

  if (starting) {
    label = t("garage.repescaStarting");
    icon = "🎲";
  } else if (hasActive) {
    label = t("garage.repescaContinue");
    icon = "⟳";
  } else if (poolSize === 0) {
    label = t("garage.repescaComplete");
    icon = "★";
    disabled = true;
    tone = "muted";
  } else if (!available) {
    label = t("garage.repescaNoneToday");
    icon = "⏳";
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
      <span aria-hidden="true">{icon}</span>
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

// "?" del header del Garaje. Mismo look que el HelpButton del Ranking
// para mantener la consistencia visual entre módulos de la app.
function HelpButton({ onClick }) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("garage.helpRepesca")}
      title={t("garage.helpRepesca")}
      className="
        flex h-7 w-7 shrink-0 items-center justify-center
        rounded-full border border-white/15 bg-white/[0.04]
        text-muted transition
        hover:border-accent/60 hover:bg-accent/10 hover:text-accent
        active:scale-90
      "
    >
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2.5-3 4.5" />
        <path d="M12 18h.01" />
      </svg>
    </button>
  );
}

// Modal con la explicación completa del modo Repesca. Lo lanza el "?" del
// header. Se complementa con RandomRepescaConfirm, que es el modal corto
// que sale justo antes de gastar la repesca; este de aquí está pensado
// para consultarse antes de decidir.
function RepescaHelpModal({ open, onClose }) {
  const { t } = useT();
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      backdropClassName="fixed inset-0 z-[95] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      panelClassName="relative w-full max-w-sm overflow-hidden rounded-2xl border border-accent/30 bg-[#0a0a0c] shadow-2xl"
    >
        <div className="absolute right-2 top-2 z-10">
          <CloseButton onClick={onClose} />
        </div>

        <div className="px-5 pb-5 pt-6 text-left">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent/10">
              <span className="text-xl" aria-hidden="true">🎲</span>
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
            <HelpRow icon="🎲" title={t("garage.repescaHelpSurprise")}>
              {t("garage.repescaHelpSurpriseDesc")}
            </HelpRow>
            <HelpRow icon="⏱️" title={t("garage.repescaHelpOnce")}>
              {t("garage.repescaHelpOnceDesc")}
            </HelpRow>
            <HelpRow icon="½" title={t("garage.repescaHelpHalf")}>
              {t("garage.repescaHelpHalfDesc")}
            </HelpRow>
            <HelpRow icon="🔥" title={t("garage.repescaHelpNoStreak")}>
              {t("garage.repescaHelpNoStreakDesc")}
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
