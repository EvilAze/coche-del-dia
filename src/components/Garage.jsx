// src/components/Garage.jsx
// Álbum de cromos del usuario, modelo "Concesionario por Secciones":
//   Vista 1 (Menú) → grid de tarjetas, una por país, con bandera de fondo.
//   Vista 2 (Showroom) → coches del país seleccionado.
//   Detail (overlay) → ficha completa de un cromo desbloqueado.
//
// Navegación: estado local `selectedCountry`. ESC y el botón ⬅ Volver
// llevan al usuario un nivel arriba en la jerarquía.

import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useEscape } from "../hooks/useEscape";
import CloseButton from "./CloseButton";

// Imagen estática que cubre los coches sin desbloquear. Debe existir en
// public/images/lona.jpg. Si falta, el fallback es la textura gris+silueta.
const LONA_IMG = "/images/lona.jpg";

// Convierte el nombre de un país a un slug compatible con el filesystem.
//   "Reino Unido"     → "reino-unido"
//   "Países Bajos"    → "paises-bajos"
//   "República Checa" → "republica-checa"
//   "EE.UU."          → "eeuu"
function slugifyCountry(pais) {
  return String(pais || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .replace(/\./g, "")               // quita puntos
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
}

function flagImagePath(pais) {
  return `/flags/${slugifyCountry(pais)}.jpg`;
}

export default function Garage({ open, onClose, user, onOpenLogin }) {
  const [state, setState] = useState({
    loading: false,
    data: null,
    error: "",
  });
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [detailCar, setDetailCar] = useState(null);

  // ESC: tres niveles en orden de prioridad.
  useEscape(open && Boolean(detailCar), () => setDetailCar(null));
  useEscape(
    open && !detailCar && Boolean(selectedCountry),
    () => setSelectedCountry(null)
  );
  useEscape(
    open && !detailCar && !selectedCountry,
    onClose
  );

  // Al cerrar el modal, reset de navegación interna para que la próxima
  // apertura empiece en la vista menú.
  useEffect(() => {
    if (!open) {
      setSelectedCountry(null);
      setDetailCar(null);
    }
  }, [open]);

  // Fetch al abrir, solo si hay sesión.
  useEffect(() => {
    if (!open || !user) return;

    setState({ loading: true, data: null, error: "" });

    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Sin sesión");

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
          error: err?.message || "No se pudo cargar el garaje.",
        });
      }
    })();
  }, [open, user]);

  if (!open) return null;

  const currentCountry =
    selectedCountry && state.data
      ? state.data.countries.find((c) => c.pais === selectedCountry) || null
      : null;

  return (
    <div
      className="fixed inset-0 z-[85] flex items-stretch justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="
          relative flex w-full max-w-md flex-col overflow-hidden
          border-x border-white/10 bg-[#0a0a0c] shadow-2xl
        "
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header del modal con back-button condicional */}
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            {currentCountry && (
              <BackButton onClick={() => setSelectedCountry(null)} />
            )}
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-accent">
                {currentCountry ? "País" : "Tu colección"}
              </p>
              <h2 className="font-display text-2xl tracking-widest text-white">
                {currentCountry ? currentCountry.pais : "Garaje"}
              </h2>
            </div>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {/* Cuerpo según estado de auth, carga y vista */}
        {!user ? (
          <AuthWall
            onLogin={() => {
              onClose();
              onOpenLogin?.();
            }}
          />
        ) : state.loading ? (
          <CenterMessage text="Abriendo el garaje..." pulse />
        ) : state.error ? (
          <CenterMessage text={state.error} tone="error" />
        ) : !state.data || state.data.countries.length === 0 ? (
          <CenterMessage text="El catálogo está vacío. Vuelve cuando haya coches que coleccionar." />
        ) : currentCountry ? (
          <Showroom
            country={currentCountry}
            onSelectCar={setDetailCar}
          />
        ) : (
          <CountriesMenu
            data={state.data}
            onSelectCountry={setSelectedCountry}
          />
        )}
      </div>

      {/* Detail del cromo (modal sobre modal) */}
      {detailCar && (
        <CarDetail car={detailCar} onClose={() => setDetailCar(null)} />
      )}
    </div>
  );
}

// ============================================================================
// Vista 1: Menú de países
// ============================================================================

function CountriesMenu({ data, onSelectCountry }) {
  return (
    <>
      {/* Resumen global */}
      <div className="border-b border-white/10 bg-white/[0.02] px-4 py-2.5 text-center">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted">
          Progreso total
        </p>
        <p className="mt-0.5 font-display text-lg text-white">
          <span className="text-accent">{data.totalUnlocked}</span>
          <span className="text-muted"> / {data.totalCatalog}</span>
        </p>
      </div>

      {/* Grid de países */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {data.countries.map((c) => (
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
  const completed = country.unlocked === country.total && country.total > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="
        group relative aspect-square w-full overflow-hidden
        rounded-xl border border-gray-800 bg-[#0d0d10]
        shadow-md shadow-black/40
        transition-transform duration-300 ease-out
        hover:scale-105 hover:border-accent/40
        active:scale-[0.98]
      "
    >
      {/* Bandera: <img> con object-cover/object-center para que NO se
          deforme nunca. Si el archivo 404, el onError la oculta y queda
          el bg base del botón. */}
      <img
        src={flagImagePath(country.pais)}
        alt=""
        aria-hidden="true"
        draggable={false}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover object-center"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />

      {/* Gradiente: transparente arriba → negro abajo. Mejora legibilidad
          del texto sin tapar la mitad superior de la bandera. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />

      {/* Badge "Completo" solo cuando el país está 100% — útil como
          incentivo visual, no satura porque solo aparece al terminar. */}
      {completed && (
        <div className="absolute right-2 top-2 rounded-full bg-accent/25 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-accent backdrop-blur-sm">
          ★ Completo
        </div>
      )}

      {/* Texto en la franja inferior, donde el gradiente es sólido. */}
      <div className="absolute inset-x-0 bottom-0 px-3 pb-3 text-center">
        <p className="font-display text-base font-bold uppercase tracking-wider text-white sm:text-lg">
          {country.pais}
        </p>
        <p className="mt-1 text-xs font-medium tabular-nums text-gray-300">
          {country.unlocked} / {country.total}
        </p>
      </div>
    </button>
  );
}

// ============================================================================
// Vista 2: Showroom (coches del país)
// ============================================================================

function Showroom({ country, onSelectCar }) {
  const progressPct = country.total
    ? Math.round((country.unlocked / country.total) * 100)
    : 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Cabecera: bloque h-40 con la bandera al fondo y un overlay
          fuerte con blur. La bandera aporta color y "lugar", el blur
          la convierte en textura para que el texto sea el protagonista. */}
      <div className="relative h-40 w-full overflow-hidden border-b border-white/10">
        <img
          src={flagImagePath(country.pais)}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover object-center"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
        {/* Overlay negro fuerte con blur sutil del fondo. */}
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

        {/* Texto centrado vertical y horizontalmente */}
        <div className="relative z-10 flex h-full flex-col items-center justify-center px-4 text-center">
          <p className="text-[10px] uppercase tracking-[0.28em] text-gray-400">
            Descubiertos {country.unlocked} / {country.total}
          </p>
          <h3 className="mt-2 font-display text-3xl font-bold uppercase tracking-wider text-white sm:text-4xl">
            {country.pais}
          </h3>
          {/* Barra de progreso justo debajo */}
          <div className="mt-3 h-1.5 w-40 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Grid de coches */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-2 gap-3 pb-3 sm:grid-cols-3">
          {country.cars.map((car) =>
            car.unlocked ? (
              <UnlockedCard
                key={car.id}
                car={car}
                onClick={() => onSelectCar(car)}
              />
            ) : (
              <LockedCard key={car.id} />
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
        group relative aspect-[4/5] w-full overflow-hidden
        rounded-lg border border-gray-800 bg-[#0d0d10]
        shadow-md shadow-black/40
        transition-transform duration-300 ease-out
        hover:scale-105 hover:border-accent/50
        active:scale-[0.98]
      "
    >
      {/* Foto del coche */}
      <img
        src={car.img}
        alt={`${car.marca} ${car.modelo}`}
        draggable={false}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover object-center"
      />

      {/* Gradiente coherente con el resto: transparente arriba → negro abajo */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/55 to-transparent" />

      {/* Etiqueta con jerarquía clara: marca en accent pequeño,
          modelo en blanco bold, año sutil para no competir. */}
      <div className="absolute inset-x-0 bottom-0 px-2.5 pb-2.5 text-left">
        <p className="truncate text-xs font-medium uppercase tracking-wider text-accent">
          {car.marca}
        </p>
        <p className="truncate text-sm font-bold text-white">
          {car.modelo}
        </p>
        <p className="mt-0.5 text-[10px] tabular-nums text-gray-400">
          {car.anio}
        </p>
      </div>
    </button>
  );
}

function LockedCard() {
  return (
    <div
      className="
        relative aspect-[4/5] w-full overflow-hidden
        rounded-lg border border-gray-800 bg-[#0d0d10]
      "
      aria-label="Cromo bloqueado"
    >
      {/* Foto de la lona: `object-cover` llena el cromo entero (sin
          huecos negros) y `object-top` ancla el encuadre a la parte
          superior. Si la foto es más ancha que el cromo se recortan
          los lados; si más alta, se recorta el pie — aceptable según
          la indicación del usuario. */}
      <img
        src={LONA_IMG}
        alt=""
        aria-hidden="true"
        draggable={false}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover object-top"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />

      {/* Gradiente desde abajo, igual que en la UnlockedCard, para
          coherencia visual entre estados. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-transparent" />

      {/* Candado pequeño + texto sutil, agrupados abajo. Ya no dominan
          el centro de la foto — quedan como un pie de página discreto. */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center pb-3">
        <LockIcon className="mb-1 h-3.5 w-3.5 text-gray-400" />
        <p className="text-[10px] font-medium uppercase tracking-widest text-gray-400">
          Desconocido
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Detail del cromo (modal sobre modal)
// ============================================================================

function CarDetail({ car, onClose }) {
  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="
          relative w-full max-w-sm overflow-hidden rounded-2xl
          border border-accent/30 bg-[#0a0a0c] shadow-2xl
          animate-fade-in
        "
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute right-2 top-2 z-10">
          <CloseButton onClick={onClose} />
        </div>

        <div className="aspect-[4/3] w-full overflow-hidden bg-bg-secondary">
          <img
            src={car.img}
            alt={`${car.marca} ${car.modelo}`}
            className="h-full w-full object-cover"
          />
        </div>

        <div className="p-4">
          <p className="text-[10px] uppercase tracking-[0.22em] text-accent">
            Desbloqueado
          </p>
          <h3 className="mt-1 font-display text-2xl tracking-wider text-white">
            {car.marca} {car.modelo}
          </h3>
          <p className="mt-0.5 font-display text-base tabular-nums text-accent">
            {car.anio}
          </p>

          {car.description ? (
            <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3 text-left">
              <p className="mb-1 text-[10px] uppercase tracking-[0.22em] text-accent">
                Ficha
              </p>
              <p className="text-sm leading-relaxed text-white/90">
                {car.description}
              </p>
            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-3 text-xs italic text-muted">
              Sin ficha. Pronto añadiremos más detalles.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Subcomponentes auxiliares
// ============================================================================

function BackButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Volver a países"
      title="Volver a países"
      className="
        flex h-9 w-9 shrink-0 items-center justify-center rounded-full
        border border-white/10 bg-white/[0.04] text-white/80
        transition hover:border-accent/60 hover:bg-accent/10 hover:text-accent
        active:scale-90
      "
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}

function CenterMessage({ text, pulse = false, tone = "default" }) {
  const toneClass =
    tone === "error" ? "text-red-400" : "text-muted";
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center">
      <p className={`text-sm ${toneClass} ${pulse ? "animate-pulse uppercase tracking-widest" : ""}`}>
        {text}
      </p>
    </div>
  );
}

function AuthWall({ onLogin }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border border-white/10 bg-bg-secondary/60 p-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full border border-accent/40 bg-accent/10">
          <LockIcon className="h-9 w-9 text-accent" />
        </div>
        <div>
          <p className="font-display text-xl tracking-widest text-white">
            Garaje cerrado
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Inicia sesión para coleccionar tus aciertos, completar el álbum
            por países y guardar tu progreso.
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
          Continuar con Google
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
