// src/admin/PreviewPanel.jsx
// Panel embebido en AdminTools: sala de pruebas para visualizar cómo se
// vería un coche con cada nivel de zoom del juego real.
//
// Equivalencia visual con el juego real:
//   El servidor (api/daily-image.js) recorta la imagen a un cuadrado de
//   lado `min(W,H) * cropPct` centrado en (focus_x, focus_y). El cliente
//   recibe ese cuadrado durante la partida y aplica scale(ZOOM_LEVELS[step])
//   alrededor de su centro — que coincide con el punto focal del original.
//
//   Aquí no pasamos por /api/daily-image (el endpoint exige autorización
//   diaria y devuelve solo el coche del día), así que simulamos el crop
//   server-side a mano: misma técnica que FocusPicker.ZoomThumb pero a
//   tamaño grande. Resultado: lo que ves aquí es PIXEL-FOR-PIXEL lo que
//   verá el jugador en su intento N con el focus que elijas.

import { useEffect, useMemo, useState } from "react";
import CarImage from "../components/CarImage";
import FocusPicker from "./FocusPicker";
import { useCatalog } from "../data/catalog";
import { supabase } from "../supabaseClient";

// Mismos zooms lógicos que el juego real (ver useGame.js / daily-image.js).
// cropPct = 1 / zoom_logico (área visible del original a ese intento).
// Mantener sincronizado con Z_TO_CROP_PCT en daily-image.js.
const STEPS = [
  { label: "1", zoomLevel: 3.7, cropPct: 0.270 },
  { label: "2", zoomLevel: 3.2, cropPct: 0.313 },
  { label: "3", zoomLevel: 2.7, cropPct: 0.370 },
  { label: "4", zoomLevel: 2.2, cropPct: 0.455 },
  { label: "5", zoomLevel: 1.7, cropPct: 0.588 },
];

export default function PreviewPanel({ selectedCarId = "", onSelectCar }) {
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
  useEffect(() => {
    if (!selectedCarId) {
      setSelectedImg("");
      setSelectedImgError("");
      // Sin coche seleccionado, volvemos al foco centrado por defecto.
      setFocus({ x: 0.5, y: 0.5 });
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
  const usingManualUrl = Boolean(urlInput.trim());
  const activeSrc = urlInput.trim() || selectedImg;

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
        <SimulatedGameImage src={activeSrc} step={step} focus={focus} />
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
          <span>x3.7</span>
          <span>x3.2</span>
          <span>x2.7</span>
          <span>x2.2</span>
          <span>x1.7</span>
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

// Replica el crop server-side + el aspecto que ve el jugador en partida.
//
//   - Steps 1-5: contenedor 1:1, fondo posicionado para mostrar un
//     cuadrado de lado `minDim * cropPct` centrado en (focus.x, focus.y).
//     Misma matemática que FocusPicker.ZoomThumb.
//   - Step 6: revelado. Contenedor con aspecto natural de la imagen y
//     foto entera, igual que el reveal del juego real.
//
// No usamos CarImage porque su flujo está pensado para imágenes ya
// recortadas por el servidor (object-cover + scale CSS desde el centro).
// Aquí trabajamos con la imagen completa y necesitamos control directo
// del crop, así que un <div> con background-image es la herramienta
// adecuada.
function SimulatedGameImage({ src, step, focus }) {
  const [dims, setDims] = useState(null);
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

  // Step 6 → revelado. Reusamos CarImage para que el reveal se vea
  // exactamente como en el juego (aspect natural, fade in, etc.).
  if (step >= 6) {
    return (
      <CarImage src={src} zoom={1.0} status="won" />
    );
  }

  // Steps 1-5: crop simulado server-side.
  const meta = STEPS[step - 1];
  if (!dims) {
    return (
      <div className="mx-auto flex aspect-square w-full max-w-[18rem] items-center justify-center rounded-xl border border-border bg-bg-tertiary text-xs text-muted sm:max-w-full">
        Cargando imagen…
      </div>
    );
  }

  const W = dims.w;
  const H = dims.h;
  const minDim = Math.min(W, H);
  const size = minDim * meta.cropPct;
  const bgW = (W / size) * 100;
  const bgH = (H / size) * 100;
  // Misma fórmula que ZoomThumb: situamos focus en el centro del frame.
  const rawPx = (100 * (2 * focus.x * W - size)) / (2 * (W - size));
  const rawPy = (100 * (2 * focus.y * H - size)) / (2 * (H - size));
  const posX = Math.max(0, Math.min(100, rawPx));
  const posY = Math.max(0, Math.min(100, rawPy));

  return (
    <div className="relative mb-3 mt-4 mx-auto w-full max-w-[18rem] overflow-hidden rounded-xl border border-border bg-bg-tertiary shadow-md shadow-black/40 sm:max-w-full">
      <div
        className="aspect-square w-full"
        style={{
          backgroundImage: `url(${src})`,
          backgroundSize: `${bgW}% ${bgH}%`,
          backgroundPosition: `${posX}% ${posY}%`,
          backgroundRepeat: "no-repeat",
          // Transiciones suaves entre intentos — igual de "premium" que
          // el zoom CSS que aplica CarImage durante la partida.
          transition:
            "background-size 0.6s cubic-bezier(0.4,0,0.2,1), background-position 0.6s cubic-bezier(0.4,0,0.2,1)",
        }}
      />
      {/* Viñeta decorativa: misma que CarImage durante "playing". */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, rgba(10,10,11,0.6) 100%)",
        }}
      />
      {/* Etiqueta de pista — réplica visual del HUD del juego. */}
      <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-2 rounded-full border border-border bg-black/70 px-3 py-1.5 backdrop-blur-sm">
        <span className="text-[10px] uppercase tracking-widest text-white">
          Pista <span className="tabular-nums">{step}</span>
          <span className="text-muted"> / {STEPS.length}</span>
        </span>
        <div className="flex gap-0.5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1 w-1.5 rounded-sm transition-colors ${
                i < step ? "bg-accent" : "bg-white/15"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
