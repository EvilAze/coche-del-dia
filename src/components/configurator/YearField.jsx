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

  const yearNum = value !== "" && value != null ? parseInt(value, 10) : NaN;
  const isInvalid = !isNaN(yearNum) && String(value).length >= 4 && (yearNum < MIN_YEAR || yearNum > MAX_YEAR);

  // Piel «Prensa del motor»: renglón de línea base con steppers −/+ como
  // botones de filete a los lados. Lógica (clamp, foco móvil) intacta.
  return (
    <div className="relative flex flex-col gap-1.5">
      <span className="prensa-label">
        <span className="prensa-label-txt">{t("cdd.labelAnio")}</span>
        <span className="pista-label">{t("cdd.yearTolerance", { n: tolerance })}</span>
      </span>
      <div className={"prensa-year" + (isInvalid ? " invalida" : "")}>
        {/* aria-label numérico explícito; el glifo visible es tipográfico. */}
        <button
          type="button"
          aria-label="-1"
          onClick={() => step(-1)}
          className="prensa-step"
        >
          −
        </button>
        <input
          ref={(el) => {
            innerRef.current = el;
            if (inputRef) inputRef.current = el;
          }}
          inputMode="numeric"
          // "go" y no "done": Enter aquí ENVÍA el intento (submit del form).
          enterKeyHint="go"
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          placeholder={t("cdd.yearPlaceholder")}
          value={value || ""}
          onFocus={() => {
            setFocused(true);
            // En táctil, sube el campo por encima del teclado recién abierto.
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
        <button
          type="button"
          aria-label="+1"
          onClick={() => step(1)}
          className="prensa-step"
        >
          +
        </button>
      </div>
    </div>
  );
}
