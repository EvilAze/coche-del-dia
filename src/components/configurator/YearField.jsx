// src/components/configurator/YearField.jsx
// Campo de año: input de línea base idéntico a Marca/Modelo. Rango alineado con
// la validación de producción (1886..año actual). El valor es string|number;
// emite number o "" (vacío).
//
// Sin steppers −/+: en un rango de ~140 años un ±1 por toque no navega nada, y
// con la tolerancia ±2 el ajuste fino es irrelevante (si pones 1970 ya aciertas
// 1968–1972). El teclado numérico teclea el año en 4 toques —más rápido y
// directo— y el campo queda en la misma cadencia visual que los otros dos.

import { useId, useRef } from "react";
import { useT } from "../../i18n";

const MIN_YEAR = 1886;
const MAX_YEAR = new Date().getFullYear();

// inputRef: expone el <input> para la cadena de foco del formulario (al elegir
// modelo, el foco salta aquí y el teclado pasa a numérico solo).
export default function YearField({ value, onChange, tolerance, inputRef = null }) {
  const { t } = useT();
  // id estable para asociar <label> ↔ <input> (a11y: gemelo de Marca/Modelo).
  const inputId = useId();
  // Ref interno (además del externo de la cadena de foco): lo necesita el
  // scrollIntoView de abajo aunque el padre no pase inputRef.
  const innerRef = useRef(null);

  const yearNum = value !== "" && value != null ? parseInt(value, 10) : NaN;
  const isInvalid = !isNaN(yearNum) && String(value).length >= 4 && (yearNum < MIN_YEAR || yearNum > MAX_YEAR);

  // Piel «Prensa del motor»: renglón de línea base, gemelo de Marca/Modelo.
  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={inputId} className="prensa-label">
        {t("cdd.labelAnio")}
        <span className="pista-label">{t("cdd.yearTolerance", { n: tolerance })}</span>
      </label>
      <input
        id={inputId}
        ref={(el) => {
          innerRef.current = el;
          if (inputRef) inputRef.current = el;
        }}
        className={"prensa-input" + (isInvalid ? " invalida" : "")}
        inputMode="numeric"
        // "go" y no "done": Enter aquí ENVÍA el intento (submit del form).
        enterKeyHint="go"
        autoComplete="off"
        data-1p-ignore="true"
        data-lpignore="true"
        placeholder={t("cdd.yearPlaceholder")}
        value={value || ""}
        onFocus={() => {
          // En táctil, sube el campo por encima del teclado recién abierto.
          const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
          if (coarse) {
            window.setTimeout(() => {
              innerRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
            }, 280);
          }
        }}
        onChange={(e) => {
          const d = e.target.value.replace(/\D/g, "").slice(0, 4);
          onChange(d ? parseInt(d, 10) : "");
        }}
        onWheel={(e) => e.currentTarget.blur()}
      />
    </div>
  );
}
