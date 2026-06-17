// src/admin/PreviewPanel.jsx
// Panel embebido en AdminTools: sala de pruebas para visualizar cómo se
// vería un coche con cada nivel de zoom del juego real.
//
// Equivalencia visual con el juego real:
//   El servidor (api/daily-image.js) recorta la imagen a un cuadrado de
//   lado `min(W,H) * cropPct` centrado en (focus_x, focus_y), donde cropPct
//   depende del `zoom_base` del coche (ver src/lib/zoom.js). El cliente recibe
//   ese cuadrado y aplica el scale CSS del intento alrededor del punto focal.
//
//   Aquí no pasamos por /api/daily-image (el endpoint exige autorización
//   diaria y devuelve solo el coche del día), así que simulamos el crop
//   server-side a mano con el mismo cropPct: misma técnica que
//   FocusPicker.ZoomThumb pero a tamaño grande. Resultado: lo que ves aquí es
//   PIXEL-FOR-PIXEL lo que verá el jugador en su intento N con el focus y el
//   zoom_base que elijas.

import { useEffect, useMemo, useRef, useState } from "react";
import ZoomStage from "../components/configurator/ZoomStage";
import StageHud from "../components/configurator/StageHud";
import FocusPicker from "./FocusPicker";
import { useCatalog } from "../data/catalog";
import { supabase } from "../supabaseClient";
import {
  DEFAULT_ZOOM_BASE,
  ZOOM_ATTEMPTS,
  cropPctForAttempt,
  zoomForAttempt,
} from "../lib/zoom.js";

// Acento del tema Platino (igual que DEFAULT_ACCENT en Configurator). El chrome
// del escenario (.cdd-*) usa variables del tema; envolvemos la preview en
// `.theme-platino` y fijamos --accent para que se vea como el juego real.
const PLATINO_ACCENT = "#7af0c8";

// El intento de "revelado" es el siguiente al último jugable.
const REVEAL_STEP = ZOOM_ATTEMPTS + 1;

export default function PreviewPanel({ selectedCarId = "", onSelectCar, overrides }) {
  const { data: catalog, loading: catalogLoading } = useCatalog();
  const CARS = catalog?.cars ?? [];

  const [step, setStep] = useState(1);
  const [urlInput, setUrlInput] = useState("");
  // Punto focal del zoom. En modo "coche del catálogo" arranca con el
  // focus_x/focus_y guardado en DB (lo que ve el jugador real). En modo
  // "URL manual" arranca centrado — no hay DB de la que tirar. El admin
  // puede arrastrarlo libremente en ambos casos; los cambios aquí NO
  // persisten — esto es solo sala de pruebas. Para guardar foco hay que
  // ir a EditCarPanel.
  const [focus, setFocus] = useState({ x: 0.5, y: 0.5 });

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

  // Lazy-fetch de image_url + focus_x/focus_y. Va por save-car (GET ?id=)
  // porque image_url está revocada para anon/auth tras el hardening RLS,
  // y save-car ya devuelve focus_x/focus_y junto al img.
  const [selectedImg, setSelectedImg] = useState("");
  const [selectedImgError, setSelectedImgError] = useState("");
  // Zoom inicial del coche seleccionado (para que la preview sea fiel a su
  // dificultad real). Default si es manual o el coche no trae la columna.
  const [selectedZoomBase, setSelectedZoomBase] = useState(DEFAULT_ZOOM_BASE);
  useEffect(() => {
    if (!selectedCarId) {
      setSelectedImg("");
      setSelectedImgError("");
      setSelectedZoomBase(DEFAULT_ZOOM_BASE);
      // Sin coche seleccionado, volvemos al foco centrado por defecto.
      setFocus({ x: 0.5, y: 0.5 });
      return;
    }

    const hasOverrides = overrides && String(overrides.carId) === String(selectedCarId);
    if (hasOverrides) {
      setSelectedImg(overrides.img || "");
      setFocus({
        x: overrides.focus_x !== undefined ? overrides.focus_x : 0.5,
        y: overrides.focus_y !== undefined ? overrides.focus_y : 0.5,
      });
      setSelectedZoomBase(
        overrides.zoom_base !== undefined ? overrides.zoom_base : DEFAULT_ZOOM_BASE
      );
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
        // save-car GET garantiza valores numéricos (0.5 por defecto si
        // la fila no tiene focus_x/y). Defensa por si cambia el contrato.
        setFocus({
          x: Number.isFinite(row?.focus_x) ? row.focus_x : 0.5,
          y: Number.isFinite(row?.focus_y) ? row.focus_y : 0.5,
        });
        setSelectedZoomBase(
          Number.isFinite(row?.zoom_base) ? row.zoom_base : DEFAULT_ZOOM_BASE
        );
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
  }, [selectedCarId, overrides]);

  // La URL pegada manualmente tiene prioridad sobre el desplegable.
  const usingManualUrl = Boolean(urlInput.trim());
  const activeSrc = urlInput.trim() || selectedImg;
  // Con URL manual no hay coche en DB → usamos el zoom por defecto.
  const activeZoomBase = usingManualUrl ? DEFAULT_ZOOM_BASE : selectedZoomBase;

  // Si el admin pega una URL manual, perdemos referencia a DB → centrado.
  // El cambio se aplica una vez al activar la URL manual, no en cada keystroke.
  useEffect(() => {
    if (usingManualUrl) setFocus({ x: 0.5, y: 0.5 });
  }, [usingManualUrl]);

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
        <SimulatedGameImage src={activeSrc} step={step} focus={focus} zoomBase={activeZoomBase} />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-2xl border border-dashed border-border bg-bg-tertiary text-sm text-muted">
          Pega una URL o elige un coche
        </div>
      )}

      <section className="flex flex-col gap-2 rounded-xl border border-border bg-bg-secondary/40 p-3">
        <div className="flex items-center justify-between text-xs uppercase tracking-widest text-muted">
          <span>
            Intento
            {!usingManualUrl && (
              <span className="ml-2 normal-case tracking-normal text-faint">
                · zoom base {activeZoomBase.toFixed(1)}×
              </span>
            )}
          </span>
          <span className="font-display text-base text-accent">
            {step} / {REVEAL_STEP} {step === REVEAL_STEP && "· revelado"}
          </span>
        </div>

        <input
          type="range"
          min={1}
          max={REVEAL_STEP}
          step={1}
          value={step}
          onChange={(e) => setStep(Number(e.target.value))}
          className="w-full accent-accent"
        />

        <div className="flex justify-between text-[10px] uppercase tracking-widest text-muted">
          {Array.from({ length: ZOOM_ATTEMPTS }, (_, i) => (
            <span key={i}>x{zoomForAttempt(i + 1, activeZoomBase).toFixed(1)}</span>
          ))}
          <span>1:1</span>
        </div>
      </section>

      {/* Selector de punto focal. Arrastra para ajustar — la preview de
          arriba reacciona en vivo. Los cambios aquí NO se persisten en
          DB; usa "Editar coche" para guardar un nuevo focus. */}
      {activeSrc && (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-bg-secondary/40 p-3">
          <div className="flex items-center justify-between text-xs uppercase tracking-widest text-muted">
            <span>Punto focal del zoom</span>
            <span className="font-display text-[10px] normal-case tracking-normal text-muted">
              {usingManualUrl ? "no persiste" : "guardado en DB"}
            </span>
          </div>
          <FocusPicker
            src={activeSrc}
            value={focus}
            onChange={setFocus}
            zoomBase={activeZoomBase}
          />
        </section>
      )}

      {selectedCar && !usingManualUrl && (
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

// Replica EXACTAMENTE lo que ve el jugador con el rediseño "configurador":
//
//   - Steps 1-5: marco cuadrado (.cdd-stage-frame, 1:1) con el HUD real
//     (StageHud: crosshair + grano). El recorte se
//     simula server-side con background-position (misma matemática que
//     FocusPicker.ZoomThumb), porque aquí trabajamos con la imagen completa
//     y no con el crop ya servido por /api/daily-image.
//   - Step 6: revelado. Reusamos el ZoomStage real → mismo chrome, mismo HUD
//     ("REVELADO" / 100%) y aspecto natural de la foto que en el juego.
//
// Todo el chrome (.cdd-*) usa variables del tema, así que envolvemos en
// `.theme-platino` con --accent fijado.
function SimulatedGameImage({ src, step, focus, zoomBase = DEFAULT_ZOOM_BASE }) {
  const [dims, setDims] = useState(null);
  const [containerAspect, setContainerAspect] = useState(1);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!src) {
      setDims(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      if (!cancelled) setDims(null);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateAspect = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerAspect(rect.width / rect.height);
      }
    };
    updateAspect();
    const observer = new ResizeObserver(updateAspect);
    observer.observe(el);
    return () => observer.disconnect();
  }, [dims]);

  // Revelado. Reusamos el ZoomStage real (status="won") para que el reveal sea
  // idéntico al del juego: marco con aspecto natural + HUD "REVELADO".
  if (step >= REVEAL_STEP) {
    return (
      <div className="theme-platino" style={{ "--accent": PLATINO_ACCENT }}>
        <ZoomStage
          car={{ img: src }}
          zoom={1}
          status="won"
          attempts={ZOOM_ATTEMPTS}
          maxAttempts={ZOOM_ATTEMPTS}
          hintIndex={0}
          totalHints={ZOOM_ATTEMPTS}
        />
      </div>
    );
  }

  // Steps 1-5: crop simulado server-side dentro del marco del configurador. El
  // % de recorte depende del zoom_base del coche (cropPctForAttempt).
  const cropPct = cropPctForAttempt(step, zoomBase);
  if (!dims) {
    return (
      <div className="theme-platino" style={{ "--accent": PLATINO_ACCENT }}>
        <div className="cdd-stage">
          <div className="cdd-stage-frame flex items-center justify-center text-xs text-muted">
            Cargando imagen…
          </div>
        </div>
      </div>
    );
  }

  const W = dims.w;
  const H = dims.h;
  const minDim = Math.min(W, H);
  const size = minDim * cropPct;

  // Adaptamos el escalado horizontal y vertical para que encaje con el aspect ratio
  // real del contenedor, evitando que la imagen se estire o deforme en pantallas 4:3 (desktop).
  const R = containerAspect;
  const bgW = (W / size) * 100;
  const bgH = (H / size) * 100 * R;

  // Calculamos la posición del fondo adaptada al aspect ratio del contenedor.
  const rawPx = (100 * (2 * focus.x * W - size)) / (2 * (W - size));
  const rawPy = (100 * (2 * focus.y * H * R - size)) / (2 * (H * R - size));
  const posX = Math.max(0, Math.min(100, rawPx));
  const posY = Math.max(0, Math.min(100, rawPy));



  return (
    <div className="theme-platino" style={{ "--accent": PLATINO_ACCENT }}>
      <div className="cdd-stage">
        <div ref={containerRef} className="cdd-stage-frame">
          {/* Capa de imagen: recorte simulado server-side. Llena el marco
              (igual que CarImage con object-cover durante la partida). */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${src})`,
              backgroundSize: `${bgW}% ${bgH}%`,
              backgroundPosition: `${posX}% ${posY}%`,
              backgroundRepeat: "no-repeat",
              // Transiciones suaves entre intentos, como el zoom CSS del juego.
              transition:
                "background-size 0.6s cubic-bezier(0.4,0,0.2,1), background-position 0.6s cubic-bezier(0.4,0,0.2,1)",
            }}
          />
          {/* HUD real del juego (crosshair + grano). El contador de intentos ya no
              vive sobre la foto (se movió a AttemptProgress, bajo la imagen). */}
          <StageHud revealed={false} />
        </div>
      </div>
    </div>
  );
}
