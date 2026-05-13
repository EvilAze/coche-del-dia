// src/Preview.jsx
// Sala de pruebas INTERNA. No enlazada desde ningún sitio.
// Acceso: /preview  o  ?preview=1
//
// Reutiliza <CarImage /> con la misma lógica de scale(zoom) que usa el juego
// real (ver src/hooks/useGame.js). NO toca localStorage, ni rachas, ni stats:
// se renderiza en lugar de <App />, así que useGame nunca se monta.

import { useEffect, useMemo, useState } from "react";
import CarImage from "./components/CarImage";
import { useCatalog } from "./data/catalog";
import { supabase } from "./supabaseClient";

// Mismos valores que useGame.js — duplicados a propósito para que la sala de
// pruebas sea independiente y no rompa si algún día cambian en el juego.
const ZOOM_LEVELS = [3.5, 3.0, 2.7, 2.4, 1.8];

// Slider 1..6 -> mismo recorrido visual que vive un jugador real:
//   1..5 = las cinco pistas progresivas
//   6    = revelado final (zoom 1.0, animación de victoria)
function zoomFromStep(step) {
  if (step >= 6) {
    return { zoom: 1.0, hintIndex: null, status: "won" };
  }
  const idx = step - 1;
  return { zoom: ZOOM_LEVELS[idx], hintIndex: idx, status: "playing" };
}

export default function Preview() {
  const { data: catalog, loading: catalogLoading } = useCatalog();
  const CARS = catalog?.cars ?? [];

  const [step, setStep] = useState(1);
  const [urlInput, setUrlInput] = useState("");
  const [selectedCarId, setSelectedCarId] = useState("");

  // Evitar que Google indexe esta página aunque alguien comparta el enlace.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const prevTitle = document.title;
    document.title = "Preview · Sala de pruebas";
    return () => {
      document.head.removeChild(meta);
      document.title = prevTitle;
    };
  }, []);

  const carsSorted = useMemo(
    () =>
      [...CARS].sort((a, b) =>
        `${a.marca} ${a.modelo}`.localeCompare(`${b.marca} ${b.modelo}`)
      ),
    [CARS]
  );

  const selectedCar = useMemo(
    () => CARS.find((c) => String(c.id) === selectedCarId) || null,
    [CARS, selectedCarId]
  );

  // Lazy-fetch del image_url cuando cambia el coche seleccionado.
  // Va via /api/admin/get-car (gateado por email admin) porque image_url
  // ya no es legible con anon key tras el hardening RLS.
  const [selectedImg, setSelectedImg] = useState("");
  const [selectedImgError, setSelectedImgError] = useState("");
  useEffect(() => {
    if (!selectedCarId) {
      setSelectedImg("");
      setSelectedImgError("");
      return;
    }
    let cancelled = false;
    setSelectedImgError("");
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        if (!cancelled) {
          setSelectedImg("");
          setSelectedImgError("Inicia sesión como admin para previsualizar.");
        }
        return;
      }
      const res = await fetch(
        `/api/admin/get-car?id=${encodeURIComponent(selectedCarId)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (cancelled) return;
      if (res.ok) {
        const row = await res.json();
        setSelectedImg(row?.img || "");
      } else if (res.status === 403) {
        setSelectedImg("");
        setSelectedImgError("Cuenta sin permisos de admin.");
      } else {
        setSelectedImg("");
        setSelectedImgError("No se pudo cargar la imagen.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCarId]);

  // La URL pegada manualmente tiene prioridad sobre el desplegable.
  const activeSrc = urlInput.trim() || selectedImg;

  const { zoom, hintIndex, status } = zoomFromStep(step);

  return (
    <div className="min-h-screen w-full bg-bg-primary font-body text-white">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-3 py-6 sm:px-4">
        <header className="border-b border-border pb-3">
          <h1 className="font-display text-2xl tracking-widest text-accent">
            SALA DE PRUEBAS
          </h1>
          <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-muted">
            Previsualizador de dificultad · interno
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs uppercase tracking-widest text-muted">
            URL manual
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://… o /coches/xxx.jpg"
              className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm normal-case tracking-normal text-white placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs uppercase tracking-widest text-muted">
            …o elige un coche del catálogo (
            {catalogLoading ? "cargando…" : CARS.length})
            <select
              value={selectedCarId}
              onChange={(e) => {
                setSelectedCarId(e.target.value);
                setUrlInput("");
              }}
              disabled={catalogLoading || CARS.length === 0}
              className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm normal-case tracking-normal text-white focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">
                {catalogLoading ? "Cargando catálogo…" : "— Selecciona —"}
              </option>
              {carsSorted.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.marca} {c.modelo} ({c.anio})
                </option>
              ))}
            </select>
            {selectedImgError && (
              <span className="text-xs normal-case tracking-normal text-red-400">
                {selectedImgError}
              </span>
            )}
          </label>
        </section>

        {activeSrc ? (
          <CarImage
            src={activeSrc}
            zoom={zoom}
            hintIndex={hintIndex}
            totalHints={ZOOM_LEVELS.length}
            status={status}
          />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center rounded-xl border border-dashed border-border bg-bg-tertiary text-sm text-muted">
            Pega una URL o elige un coche
          </div>
        )}

        <section className="flex flex-col gap-2 rounded-xl border border-border bg-bg-secondary/40 p-3">
          <div className="flex items-center justify-between text-xs uppercase tracking-widest text-muted">
            <span>Intento</span>
            <span className="font-display text-base text-accent">
              {step} / 6 {step === 6 && "· revelado"}
            </span>
          </div>

          <input
            type="range"
            min={1}
            max={6}
            step={1}
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
            className="w-full accent-accent"
          />

          <div className="flex justify-between text-[10px] uppercase tracking-widest text-muted">
            <span>x3.5</span>
            <span>x3</span>
            <span>x2.5</span>
            <span>x2</span>
            <span>x1.5</span>
            <span>1:1</span>
          </div>
        </section>

        {selectedCar && !urlInput.trim() && (
          <section className="rounded-xl border border-border bg-bg-secondary/40 p-3 text-xs text-muted">
            <div>
              <span className="text-muted">ID:</span>{" "}
              <span className="text-white">{selectedCar.id}</span>
            </div>
            <div>
              <span className="text-muted">Respuesta:</span>{" "}
              <span className="text-white">
                {selectedCar.marca} {selectedCar.modelo} · {selectedCar.anio}
              </span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
