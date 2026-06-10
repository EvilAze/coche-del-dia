// src/components/configurator/YearField.jsx
// Campo de año con stepper ↑/↓. Rango alineado con la validación de producción
// (1886..año actual). El valor es string|number; emite number o "" (vacío).

import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { Icon, I } from "./icons";

const MIN_YEAR = 1886;
const MAX_YEAR = new Date().getFullYear();

// inputRef: expone el <input> para la cadena de foco del formulario (al elegir
// modelo, el foco salta aquí y el teclado pasa a numérico solo).
export default function YearField({ value, onChange, tolerance, inputRef = null }) {
  const { t } = useT();
  const clamp = (v) => Math.max(MIN_YEAR, Math.min(MAX_YEAR, v));
  const step = (delta) => {
    haptic.selection();
    const base = Number.isFinite(Number(value)) && value !== "" ? Number(value) : MAX_YEAR;
    onChange(clamp(base + delta));
  };
  return (
    <div className="cdd-field">
      <label className="cdd-label cdd-mono">
        {t("cdd.labelAnio")}
        <span className="cdd-label-hint">{t("cdd.yearTolerance", { n: tolerance })}</span>
      </label>
      <div className="cdd-year">
        <input
          ref={inputRef}
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
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, "").slice(0, 4);
            onChange(d ? parseInt(d, 10) : "");
          }}
          onWheel={(e) => e.currentTarget.blur()}
        />
        <div className="cdd-year-steps">
          <button type="button" aria-label="+1" onClick={() => step(1)}><Icon d={I.arrowU} size={14} /></button>
          <button type="button" aria-label="-1" onClick={() => step(-1)}><Icon d={I.arrowD} size={14} /></button>
        </div>
      </div>
    </div>
  );
}
