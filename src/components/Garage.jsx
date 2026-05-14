// src/components/Garage.jsx
// Álbum de cromos del usuario: catálogo entero agrupado por país, con
// los coches que ha desbloqueado mostrados a color y los que faltan
// cubiertos con una "lona" estilo cromo sin abrir.
//
// Estructura:
//   - Modal fullscreen estilo Ranking.
//   - Si no hay sesión → auth wall con CTA de login.
//   - Si hay sesión → fetch a /api/garage, render del swiper horizontal
//     con CSS scroll-snap (sin librerías externas).
//
// Swiper: usamos `overflow-x-auto + snap-x snap-mandatory` para que cada
// "pantalla" del álbum encaje exactamente en el viewport del modal. En
// móvil el dedo basta; en desktop hay flechas laterales.

import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { useEscape } from "../hooks/useEscape";
import { flagFor } from "../data/countries";
import CloseButton from "./CloseButton";

export default function Garage({ open, onClose, user, onOpenLogin }) {
  const [state, setState] = useState({
    loading: false,
    data: null,
    error: "",
  });
  const [activeIdx, setActiveIdx] = useState(0);
  const [detailCar, setDetailCar] = useState(null); // cromo abierto en zoom
  const swiperRef = useRef(null);

  // Cierra con ESC, salvo cuando hay un detail abierto (deja que el
  // detail capture su propio ESC).
  useEscape(open && !detailCar, onClose);
  useEscape(Boolean(detailCar), () => setDetailCar(null));

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

  // Track manual swipe → update dot indicator.
  useEffect(() => {
    const el = swiperRef.current;
    if (!el) return;
    function onScroll() {
      const w = el.clientWidth || 1;
      const idx = Math.round(el.scrollLeft / w);
      setActiveIdx(idx);
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [state.data]);

  // Cuando se abre el modal, reset al primer país.
  useEffect(() => {
    if (open && swiperRef.current) {
      swiperRef.current.scrollTo({ left: 0, behavior: "auto" });
      setActiveIdx(0);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[85] flex items-stretch justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="
          relative flex w-full max-w-md flex-col overflow-hidden
          border-x border-white/10 bg-[#0a0a0c]
          shadow-2xl
        "
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-accent">
              Tu colección
            </p>
            <h2 className="font-display text-2xl tracking-widest text-white">
              Garaje
            </h2>
          </div>
          <CloseButton onClick={onClose} />
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
          <div className="flex flex-1 items-center justify-center p-6">
            <p className="animate-pulse text-sm uppercase tracking-widest text-muted">
              Abriendo el garaje...
            </p>
          </div>
        ) : state.error ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <p className="text-sm text-red-400">{state.error}</p>
          </div>
        ) : !state.data || state.data.countries.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center">
            <p className="text-sm text-muted">
              El catálogo está vacío. Vuelve cuando haya coches que coleccionar.
            </p>
          </div>
        ) : (
          <GarageContent
            data={state.data}
            swiperRef={swiperRef}
            activeIdx={activeIdx}
            onSelectCar={setDetailCar}
            onJumpTo={(idx) => {
              const el = swiperRef.current;
              if (!el) return;
              el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
            }}
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

// ---- Subcomponentes ----

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

function GarageContent({ data, swiperRef, activeIdx, onSelectCar, onJumpTo }) {
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

      {/* Swiper horizontal: contenedor con overflow + flex; cada hijo ocupa
          el 100% del CONTENEDOR (no del flex interno), con flex-shrink:0
          para que no se compriman entre sí. Así 15 países = 15 slides
          apiladas horizontalmente, cada una del ancho del modal.
          `[&::-webkit-scrollbar]:hidden` + scrollbarWidth ocultan la barra. */}
      <div
        ref={swiperRef}
        className="
          flex flex-1 overflow-x-auto overflow-y-hidden
          snap-x snap-mandatory scroll-smooth
          [&::-webkit-scrollbar]:hidden
        "
        style={{
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
        }}
      >
        {data.countries.map((country) => (
          <CountryPage
            key={country.pais}
            country={country}
            onSelectCar={onSelectCar}
          />
        ))}
      </div>

      {/* Footer: dots de navegación */}
      <div className="flex items-center justify-center gap-2 border-t border-white/10 bg-[#08080a] px-4 py-3">
        {data.countries.map((c, i) => (
          <button
            key={c.pais}
            type="button"
            onClick={() => onJumpTo(i)}
            aria-label={`Ir a ${c.pais}`}
            className={`
              h-2 rounded-full transition-all
              ${i === activeIdx ? "w-6 bg-accent" : "w-2 bg-white/20 hover:bg-white/40"}
            `}
          />
        ))}
      </div>
    </>
  );
}

function CountryPage({ country, onSelectCar }) {
  const flag = flagFor(country.pais);
  const progressPct = country.total
    ? Math.round((country.unlocked / country.total) * 100)
    : 0;

  return (
    <section
      className="
        w-full shrink-0 snap-center overflow-y-auto
        px-4 py-4
        [&::-webkit-scrollbar]:hidden
      "
      style={{
        flex: "0 0 100%",
        scrollbarWidth: "none",
      }}
    >
      <header className="mb-4 text-center">
        <div className="text-5xl leading-none" aria-hidden="true">
          {flag}
        </div>
        <h3 className="mt-2 font-display text-2xl tracking-widest text-white">
          {country.pais}
        </h3>
        <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-muted">
          Descubiertos {country.unlocked} / Total {country.total}
        </p>
        {/* Barra de progreso del país */}
        <div className="mx-auto mt-3 h-1.5 w-32 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-700"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </header>

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
    </section>
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
      {/* Imagen */}
      <div className="absolute inset-0 overflow-hidden">
        <img
          src={car.img}
          alt={`${car.marca} ${car.modelo}`}
          draggable={false}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      </div>

      {/* Gradient inferior para legibilidad */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/55 to-transparent" />

      {/* Etiqueta */}
      <div className="absolute inset-x-0 bottom-0 p-2 text-left">
        <p className="truncate font-display text-[11px] uppercase tracking-widest text-accent">
          {car.marca}
        </p>
        <p className="truncate text-xs text-white">
          {car.modelo}
        </p>
        <p className="text-[10px] tabular-nums text-muted">{car.anio}</p>
      </div>

      {/* Esquina decorativa estilo cromo */}
      <div className="absolute right-1.5 top-1.5 rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-accent backdrop-blur-sm">
        ✓
      </div>
    </button>
  );
}

function LockedCard() {
  return (
    <div
      className="
        relative aspect-[4/5] w-full overflow-hidden rounded-lg
        border border-white/5 bg-[#15151a]
      "
      aria-label="Cromo bloqueado"
    >
      {/* Textura de líneas diagonales */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0 6px, transparent 6px 12px)",
        }}
      />

      {/* Silueta de coche */}
      <div className="absolute inset-0 flex items-center justify-center">
        <CarSilhouette className="h-12 w-12 text-white/10" />
      </div>

      {/* Etiqueta */}
      <div className="absolute inset-x-0 bottom-0 p-2 text-center">
        <p className="font-display text-[10px] uppercase tracking-[0.18em] text-muted">
          Bloqueado
        </p>
      </div>

      {/* Candado decorativo */}
      <div className="absolute right-1.5 top-1.5 rounded-full bg-white/5 p-1">
        <LockIcon className="h-3 w-3 text-white/30" />
      </div>
    </div>
  );
}

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

// ---- Icons ----

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

function CarSilhouette({ className = "" }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M52 36h-2.4l-3.2-9.6A4 4 0 0 0 42.6 24H21.4a4 4 0 0 0-3.8 2.4L14.4 36H12a4 4 0 0 0-4 4v6h4a4 4 0 0 0 8 0h24a4 4 0 0 0 8 0h4v-6a4 4 0 0 0-4-4Zm-31.7-7.6.6-1.4h20.2l.6 1.4 2.5 7.6H17.8l2.5-7.6ZM16 46a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm32 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" />
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
