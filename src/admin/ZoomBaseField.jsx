// src/admin/ZoomBaseField.jsx
// Slider de "zoom inicial" por coche (dificultad). Lo usan AddCarPanel y
// EditCarPanel. El valor es el zoom lógico del intento 1. Subirlo = empezar más
// cerca y revelar menos en todos los intentos. La tira de miniaturas del
// FocusPicker (que recibe el mismo zoomBase) muestra el efecto en vivo.
//
// OJO al balancear: los 5 intentos NO bajan "en saltos fijos de 0.5", como
// decía aquí. La curva es LOGARÍTMICA CON EASING (ZOOM_EASE, src/lib/zoom.js) y
// BACK-LOADED: cada paso es mayor que el anterior y el salto gordo cae en el
// 4→5. El span es un RATIO constante (ZOOM_SPAN): el intento 5 es siempre
// base/2.1765, así que TODO coche revela el mismo factor total y el slider solo
// decide cuánto se cierra el teaser inicial — mueve los cinco niveles a la vez,
// en proporción, sin deformar la curva.
//
// La escalera de abajo lista los CINCO niveles (no solo los extremos) con la
// misma fórmula que usa el juego, porque el reparto intermedio es justo lo que
// se calibra al mover el slider y con solo los extremos era invisible. Es la
// misma que pintan la tira de miniaturas del FocusPicker y el PreviewPanel.

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
  // % del lado menor visible en CADA intento (a menor %, más zoom / más
  // difícil). Misma fuente que el juego: cropPctForAttempt.
  const pasos = Array.from({ length: ZOOM_ATTEMPTS }, (_, i) =>
    Math.round(cropPctForAttempt(i + 1, base) * 100)
  );
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
          muestra por intento (% del lado)
        </span>
      </div>
      {/* Escalera de los 5 intentos. El último va en acento porque es el paso
          más grande de la curva (back-loaded) y el que decide la derrota. */}
      <div className="flex justify-between font-mono text-[10px] text-muted">
        {pasos.map((pct, i) => (
          <span key={i} className={i === pasos.length - 1 ? "text-accent" : undefined}>
            {i + 1}: {pct}%
          </span>
        ))}
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
