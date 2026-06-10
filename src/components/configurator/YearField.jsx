// src/components/configurator/YearField.jsx
// Campo de año con stepper ↑/↓. Rango alineado con la validación de producción
// (1886..año actual). El valor es string|number; emite number o "" (vacío).

import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { Icon, I } from "./icons";

const MIN_YEAR = 1886;
const MAX_YEAR = new Date().getFullYear();

export default function YearField({ value, onChange, tolerance, inputRef = null }) {
  const { t } = useT();
  const clamp = (v) => Math.max(MIN_YEAR, Math.min(MAX_YEAR, v));
  const step = (delta) => {
    haptic.selection();
    const base = Number.isFinite(Number(value)) && value !== "" ? Number(value) : MAX_YEAR;
    onChange(clamp(base + delta));
  };
  // Al abrirse el teclado numérico, subimos el campo por encima de él (mismo
  // patrón que Combo): el año es el campo más bajo del fold y el que el
  // teclado tapa seguro, tanto al tocarlo como cuando la cadena de foco salta
  // aquí tras elegir modelo. 280 ms = animación del teclado; solo en táctil.
  const onFocus = () => {
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
    if (coarse) {
      window.setTimeout(() => {
        inputRef?.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      }, 280);
    }
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
          enterKeyHint="done"
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          placeholder={t("cdd.yearPlaceholder")}
          value={value || ""}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, "").slice(0, 4);
            onChange(d ? parseInt(d, 10) : "");
          }}
          onFocus={onFocus}
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
