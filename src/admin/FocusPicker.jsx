// src/admin/FocusPicker.jsx
// Permite al admin elegir EL PUNTO desde el que nace el zoom del juego.
// Dos zonas:
//   1. Selector grande con la imagen entera. Un círculo arrastrable
//      sobre la imagen indica (focus_x, focus_y) en coordenadas [0,1].
//   2. Tira de 5 previews pequeños — uno por cada nivel de zoom del
//      juego — que se actualizan EN VIVO mientras arrastras. El admin
//      no necesita guardar y refrescar para comprobar cómo cuadrará.
//
// Las previews simulan el crop del servidor (api/daily-image.js) usando
// CSS background-position. Eso evita pedir 5 imágenes nuevas al backend
// cada vez que mueves el punto — todo es local hasta que pulsas Guardar
// en el panel padre.

import { useEffect, useRef, useState } from "react";

// Mismos valores que daily-image.js Z_TO_CROP_PCT. Si esto se actualiza
// en el servidor, hay que actualizarlo también aquí — y en useGame.js.
const ZOOM_PREVIEWS = [
  { label: "1", cropPct: 0.270 },
  { label: "2", cropPct: 0.313 },
  { label: "3", cropPct: 0.370 },
  { label: "4", cropPct: 0.455 },
  { label: "5", cropPct: 0.588 },
];

function clamp01(n) {
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export default function FocusPicker({
  src,
  value = { x: 0.5, y: 0.5 },
  onChange,
  disabled = false,
}) {
  const containerRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  // Guardamos onChange en una ref para que los listeners attachados a
  // window vean siempre la versión más reciente del callback — si el
  // padre re-renderiza durante el drag (algo que pasa con cada onChange),
  // los listeners de window se quedarían con la closure antigua. Esto
  // también nos permite NO añadirlos como dependencias del useEffect.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Dimensiones naturales de la imagen — necesarias para calcular el
  // background-size de las previews. Si la imagen aún no cargó, los
  // previews salen ocultos hasta que tengamos los datos.
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

  // ---- Drag handlers ----
  // Patrón clásico de slider/picker custom: al hacer pointer-down,
  // attacha listeners a `window` y los desconecta al soltar. Es más
  // robusto que setPointerCapture en este caso, que tenía un bug donde
  // ciertos navegadores disparaban un pointermove espurio tras soltar
  // y dejaban el punto en una posición distinta a la elegida.
  function pointerPosToFocus(clientX, clientY) {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  }

  function handlePointerDown(e) {
    if (disabled) return;
    // preventDefault evita que el navegador inicie un drag nativo de la
    // imagen o seleccione texto cercano al arrastrar.
    e.preventDefault();
    setDragging(true);
    const next = pointerPosToFocus(e.clientX, e.clientY);
    if (next && onChangeRef.current) onChangeRef.current(next);

    function onWindowMove(ev) {
      const n = pointerPosToFocus(ev.clientX, ev.clientY);
      if (n && onChangeRef.current) onChangeRef.current(n);
    }
    function onWindowUp() {
      setDragging(false);
      window.removeEventListener("pointermove", onWindowMove);
      window.removeEventListener("pointerup", onWindowUp);
      window.removeEventListener("pointercancel", onWindowUp);
    }
    window.addEventListener("pointermove", onWindowMove);
    window.addEventListener("pointerup", onWindowUp);
    window.addEventListener("pointercancel", onWindowUp);
  }

  function resetCenter() {
    if (disabled) return;
    if (onChangeRef.current) onChangeRef.current({ x: 0.5, y: 0.5 });
  }

  const px = clamp01(value?.x ?? 0.5);
  const py = clamp01(value?.y ?? 0.5);

  return (
    <div className="flex flex-col gap-3">
      {/* Selector grande con punto arrastrable */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        // preventDefault del click es CRÍTICO: el padre envuelve este
        // componente en un <label> (vía el helper Field). Por spec HTML,
        // el click sobre un label activa con un click sintético al primer
        // control de formulario descendente. Como el primer control aquí
        // es el botón "Centrar", al soltar el drag se disparaba el reset
        // automáticamente. preventDefault cancela esa activación.
        onClick={(e) => e.preventDefault()}
        className={`
          relative w-full overflow-hidden rounded-xl border border-border
          bg-black/40 touch-none select-none
          ${disabled ? "cursor-not-allowed opacity-60" : "cursor-crosshair"}
        `}
        style={{ aspectRatio: dims ? `${dims.w} / ${dims.h}` : "4 / 3" }}
      >
        {src ? (
          <img
            src={src}
            alt="Punto focal"
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-widest text-muted">
            Sin imagen
          </div>
        )}

        {/* Cruceta del punto */}
        {src && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: `${px * 100}%`,
              top: `${py * 100}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            {/* Círculo exterior */}
            <div
              className={`
                h-8 w-8 rounded-full border-2 border-accent
                shadow-[0_0_0_2px_rgba(0,0,0,0.6)]
                ${dragging ? "scale-110" : ""}
                transition-transform
              `}
            />
            {/* Punto interior */}
            <div
              className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_1.5px_rgba(0,0,0,0.6)]"
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted">
        <span>
          Foco: <span className="text-white">{(px * 100).toFixed(0)}%</span> ·{" "}
          <span className="text-white">{(py * 100).toFixed(0)}%</span>
        </span>
        <button
          type="button"
          onClick={resetCenter}
          disabled={disabled || (px === 0.5 && py === 0.5)}
          className="
            rounded-md border border-white/10 px-2 py-1 normal-case tracking-normal
            text-white transition hover:border-accent
            disabled:cursor-not-allowed disabled:opacity-40
          "
        >
          Centrar
        </button>
      </div>

      {/* Tira de previews de los 5 niveles de zoom */}
      <div className="grid grid-cols-5 gap-2">
        {ZOOM_PREVIEWS.map((z) => (
          <ZoomThumb
            key={z.label}
            label={z.label}
            cropPct={z.cropPct}
            src={src}
            dims={dims}
            focusX={px}
            focusY={py}
          />
        ))}
      </div>
      <p className="text-[10px] uppercase tracking-widest text-muted">
        Intentos 1 → 5 · así verá el jugador cada pista
      </p>
    </div>
  );
}

// Cada preview simula el crop server-side via CSS background-position.
// Geometría:
//   - Crop = cuadrado de lado `size = min(W,H) * cropPct`, centrado en
//     (focusX*W, focusY*H), clamped a los bordes.
//   - Para mostrar EXACTAMENTE ese cuadrado en un contenedor cuadrado de
//     lado D, el background debe escalarse a (W*D/size, H*D/size) y la
//     `background-position` (en %) debe situar el punto focal en el centro.
function ZoomThumb({ label, cropPct, src, dims, focusX, focusY }) {
  if (!src || !dims) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-md border border-border bg-bg-tertiary text-[10px] text-muted">
        {label}
      </div>
    );
  }

  const W = dims.w;
  const H = dims.h;
  const minDim = Math.min(W, H);
  const size = minDim * cropPct;

  // Background-size en %: (W/size)*100 horizontalmente, (H/size)*100
  // verticalmente. Si W=H y size=cropPct*W, ambos valen 1/cropPct.
  const bgW = (W / size) * 100;
  const bgH = (H / size) * 100;

  // background-position en porcentaje:
  // P_x = 100 * (2*focusX*W - size) / (2*(W - size))   clamped a [0, 100]
  // El caso degenerado W == size (cropPct == 1, no usamos en este set)
  // habría que tratarlo con divisor cero — aquí no aplica.
  const rawPx = (100 * (2 * focusX * W - size)) / (2 * (W - size));
  const rawPy = (100 * (2 * focusY * H - size)) / (2 * (H - size));
  const posX = Math.max(0, Math.min(100, rawPx));
  const posY = Math.max(0, Math.min(100, rawPy));

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="aspect-square w-full overflow-hidden rounded-md border border-border bg-black/40"
        style={{
          backgroundImage: `url(${src})`,
          backgroundSize: `${bgW}% ${bgH}%`,
          backgroundPosition: `${posX}% ${posY}%`,
          backgroundRepeat: "no-repeat",
        }}
      />
      <span className="text-[10px] uppercase tracking-widest text-muted">
        {label}
      </span>
    </div>
  );
}
