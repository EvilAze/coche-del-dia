// src/admin/ZoomBaseField.jsx
// Slider de "zoom inicial" por coche (dificultad). Lo usan AddCarPanel y
// EditCarPanel. El valor es el zoom lógico del intento 1; los 5 intentos bajan
// en saltos fijos de 0.5 (fórmula en src/lib/zoom.js). Subirlo = empezar más
// cerca y revelar menos en todos los intentos. La tira de miniaturas del
// FocusPicker (que recibe el mismo zoomBase) muestra el efecto en vivo.

import {
  DEFAULT_ZOOM_BASE,
  ZOOM_BASE_MIN,
  ZOOM_BASE_MAX,
  ZOOM_ATTEMPTS,
  cropPctForAttempt,
} from "../lib/zoom.js";

export default function ZoomBaseField({
  value = DEFAULT_ZOOM_BASE,
  onChange,
  disabled = false,
}) {
  const base = typeof value === "number" ? value : DEFAULT_ZOOM_BASE;
  // % del lado menor visible en el primer y último intento (a menor %, más
  // zoom / más difícil).
  const startPct = Math.round(cropPctForAttempt(1, base) * 100);
  const endPct = Math.round(cropPctForAttempt(ZOOM_ATTEMPTS, base) * 100);
  const isDefault = Math.abs(base - DEFAULT_ZOOM_BASE) < 0.001;

  return (
    <div className="flex flex-col gap-2">
      <input
        type="range"
        min={ZOOM_BASE_MIN}
        max={ZOOM_BASE_MAX}
        step={0.1}
        value={base}
        onChange={(e) => onChange?.(Number(e.target.value))}
        disabled={disabled}
        className="w-full accent-accent disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted">
        <span>
          Zoom inicial:{" "}
          <span className="font-display text-sm text-accent">{base.toFixed(1)}×</span>
          {isDefault && <span className="ml-2 normal-case tracking-normal">· por defecto</span>}
        </span>
        <span className="normal-case tracking-normal">
          muestra: intento 1 ~{startPct}% → intento 5 ~{endPct}%
        </span>
      </div>
      {!isDefault && (
        <button
          type="button"
          onClick={() => onChange?.(DEFAULT_ZOOM_BASE)}
          disabled={disabled}
          className="self-start rounded-md border border-white/10 px-2 py-1 text-[10px] uppercase tracking-widest text-white transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          Restablecer ({DEFAULT_ZOOM_BASE}×)
        </button>
      )}
    </div>
  );
}
