// src/components/configurator/YearField.jsx
// Campo de año con stepper +/− y "décadas rápidas". Rango alineado con la
// validación de producción (1886..año actual). El valor es string|number;
// emite number o "" (vacío).
//
// Auditoría UX #6:
//   - Los steppers usan +/− y no flechas ↑/↓: el mismo glifo de flecha ya
//     significa "el año real es más nuevo/antiguo" en el feedback del intento,
//     a centímetros de aquí — dos semánticas, un símbolo, confusión gratis.
//   - Décadas rápidas: con rango 1886..hoy, ±1 por tap no navega nada. Al
//     enfocar el campo VACÍO aparece una fila de chips (60s…20s) en overlay
//     absoluto (cero layout shift, como el listbox del Combo): un tap fija el
//     ecuador de la década (p.ej. 1995) — submittable al instante con la
//     tolerancia ±2 — y el teclado numérico/steppers afinan desde ahí.

import { useRef, useState } from "react";
import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";

const MIN_YEAR = 1886;
const MAX_YEAR = new Date().getFullYear();
// Décadas con presencia real en el catálogo. Fila única que cabe en móvil.
const DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020];

// inputRef: expone el <input> para la cadena de foco del formulario (al elegir
// modelo, el foco salta aquí y el teclado pasa a numérico solo).
export default function YearField({ value, onChange, tolerance, inputRef = null }) {
  const { t } = useT();
  const [focused, setFocused] = useState(false);
  // Ref interno (además del externo de la cadena de foco): lo necesita el
  // scrollIntoView de abajo aunque el padre no pase inputRef.
  const innerRef = useRef(null);
  const clamp = (v) => Math.max(MIN_YEAR, Math.min(MAX_YEAR, v));
  const step = (delta) => {
    haptic.selection();
    const base = Number.isFinite(Number(value)) && value !== "" ? Number(value) : MAX_YEAR;
    onChange(clamp(base + delta));
  };
  // Solo con el campo vacío: en cuanto hay valor, los chips sobran y se van.
  const showDecades = focused && (value === "" || value == null);

  return (
    <div className="cdd-field">
      <label className="cdd-label cdd-mono">
        {t("cdd.labelAnio")}
        <span className="cdd-label-hint">{t("cdd.yearTolerance", { n: tolerance })}</span>
      </label>
      <div className="cdd-year">
        <input
          ref={(el) => {
            innerRef.current = el;
            if (inputRef) inputRef.current = el;
          }}
          className="cdd-input cdd-year-input"
          inputMode="numeric"
          // "go" y no "done": Enter aquí ENVÍA el intento (submit del form),
          // así el pulgar nunca tiene que viajar hasta el botón.
          enterKeyHint="go"
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          placeholder={t("cdd.yearPlaceholder")}
          value={value || ""}
          onFocus={() => {
            setFocused(true);
            // Mismo patrón que Combo (su línea ~85): en pantallas táctiles,
            // sube el campo por encima del teclado recién abierto. Este es el
            // campo MÁS BAJO del fold — sin esto, el teclado lo tapa seguro.
            // 280ms ≈ animación de apertura del teclado. block:"start" deja
            // sitio debajo para el overlay de décadas.
            const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
            if (coarse) {
              window.setTimeout(() => {
                innerRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
              }, 280);
            }
          }}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, "").slice(0, 4);
            onChange(d ? parseInt(d, 10) : "");
          }}
          onWheel={(e) => e.currentTarget.blur()}
        />
        <div className="cdd-year-steps">
          {/* aria-label numérico explícito; el glifo visible es tipográfico. */}
          <button type="button" aria-label="+1" onClick={() => step(1)}>+</button>
          <button type="button" aria-label="-1" onClick={() => step(-1)}>−</button>
        </div>
        {showDecades && (
          <div className="cdd-decades" role="group" aria-label={t("cdd.decadesAria")}>
            {DECADES.map((d) => (
              <button
                key={d}
                type="button"
                className="cdd-decade cdd-mono"
                // mousedown prevenido: que el chip NO robe el foco del input
                // (el blur cerraría el panel antes de que llegue el click).
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  haptic.selection();
                  onChange(d + 5);
                }}
              >
                {String(d).slice(2)}s
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
