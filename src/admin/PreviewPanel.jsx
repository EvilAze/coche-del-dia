// src/admin/PreviewPanel.jsx
// Panel embebido en AdminTools: sala de pruebas para visualizar cómo se
// vería un coche con cada nivel de zoom del juego real. Refactor de
// src/Preview.jsx — sin gate de sesión, sin layout fullscreen, acepta
// selectedCarId para preselección y onSelectCar para mantener el shell
// sincronizado entre tabs.

import { useEffect, useMemo, useState } from "react";
import CarImage from "../components/CarImage";
import { useCatalog } from "../data/catalog";
import { supabase } from "../supabaseClient";

const ZOOM_LEVELS = [3.5, 3.0, 2.7, 2.4, 1.8];

function zoomFromStep(step) {
  if (step >= 6) {
    return { zoom: 1.0, hintIndex: null, status: "won" };
  }
  const idx = step - 1;
  return { zoom: ZOOM_LEVELS[idx], hintIndex: idx, status: "playing" };
}

export default function PreviewPanel({ selectedCarId = "", onSelectCar }) {
  const { data: catalog, loading: catalogLoading } = useCatalog();
  const CARS = catalog?.cars ?? [];

  const [step, setStep] = useState(1);
  const [urlInput, setUrlInput] = useState("");

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

  // Lazy-fetch del image_url. Va por save-car (GET ?id=) porque image_url
  // está revocada para anon/auth tras el hardening RLS.
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
        `/api/admin/save-car?id=${encodeURIComponent(selectedCarId)}`,
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

  function handleSelectChange(value) {
    setUrlInput("");
    if (typeof onSelectCar === "function") onSelectCar(value);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="border-b border-border pb-3">
        <h2 className="font-display text-2xl tracking-widest text-white">
          Sala de pruebas
        </h2>
        <p className="mt-1 text-xs text-muted">
          Previsualizador de dificultad — mismo recorrido de zoom que vive
          un jugador real.
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
            onChange={(e) => handleSelectChange(e.target.value)}
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
          <span>x2.7</span>
          <span>x2.4</span>
          <span>x1.8</span>
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
  );
}
