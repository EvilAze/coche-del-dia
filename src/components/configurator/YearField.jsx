// src/components/configurator/YearField.jsx
// Campo de año: input de línea base idéntico a Marca/Modelo. Rango alineado con
// la validación de producción (1886..año actual). El valor es string|number;
// emite number o "" (vacío).
//
// Sin steppers −/+: en un rango de ~140 años un ±1 por toque no navega nada, y
// con la tolerancia ±2 el ajuste fino es irrelevante (si pones 1970 ya aciertas
// 1968–1972). El teclado numérico teclea el año en 4 toques —más rápido y
// directo— y el campo queda en la misma cadencia visual que los otros dos.
//
// Además del estado "resuelto" que comparte con Combo, este campo lleva LA
// HORQUILLA: el rango que sigue vivo según las flechas ↑/↓ acumuladas. Marca y
// modelo no la necesitan porque el combo elimina de la lista lo ya fallado, pero
// el año no se elimina de ningún sitio: sin la horquilla habría que releer el
// historial entero para saber por dónde va la búsqueda.

import { useId, useRef } from "react";
import { acercarCampoAlTeclado } from "../../lib/teclado";
import { useT } from "../../i18n";

const MIN_YEAR = 1886;
const MAX_YEAR = new Date().getFullYear();

// inputRef: expone el <input> para la cadena de foco del formulario (al elegir
// modelo, el foco salta aquí y el teclado pasa a numérico solo).
export default function YearField({
  value,
  onChange,
  tolerance,
  inputRef = null,
  // Estado del campo (ver el bloque de Combo.jsx). La flecha del último fallo
  // que hubo aquí se retiró con el resto del veredicto: la horquilla de abajo
  // dice lo mismo con más precisión («entre 1974 y 1989» en vez de «más arriba»).
  estado = null,
  bloqueado = false,
  // Horquilla viva: { min, max, acotada } de lib/yearRange.
  horquilla = null,
}) {
  const { t } = useT();
  // id estable para asociar <label> ↔ <input> (a11y: gemelo de Marca/Modelo).
  const inputId = useId();
  // Ref interno (además del externo de la cadena de foco): lo necesita el
  // scrollIntoView de abajo aunque el padre no pase inputRef.
  const innerRef = useRef(null);

  const resuelto = estado === "resuelto" || bloqueado;

  const yearNum = value !== "" && value != null ? parseInt(value, 10) : NaN;
  const isInvalid = !isNaN(yearNum) && String(value).length >= 4 && (yearNum < MIN_YEAR || yearNum > MAX_YEAR);

  // Texto de la horquilla. Tres formas según qué extremos se hayan movido: con
  // los dos, un intervalo; con uno solo, un "desde"/"hasta" (decir «entre 1886 y
  // 2007» sería técnicamente cierto y prácticamente ruido).
  let horquillaTexto = null;
  if (horquilla?.acotada && !resuelto) {
    const { min, max } = horquilla;
    if (min > MIN_YEAR && max < MAX_YEAR) horquillaTexto = t("cdd.yearRangeBetween", { min, max });
    else if (min > MIN_YEAR) horquillaTexto = t("cdd.yearRangeFrom", { min });
    else horquillaTexto = t("cdd.yearRangeTo", { max });
  }

  // Piel «Prensa del motor»: renglón de línea base, gemelo de Marca/Modelo.
  return (
    <div className="relative flex flex-col gap-0.5">
      <label htmlFor={inputId} className="prensa-label">
        {t("cdd.labelAnio")}
        {resuelto ? (
          <span className="pista-label resuelta">{t("cdd.fieldSolved")}</span>
        ) : (
          <span className="pista-label">{t("cdd.yearTolerance", { n: tolerance })}</span>
        )}
      </label>
      <div className="prensa-campo">
        <input
          id={inputId}
          ref={(el) => {
            innerRef.current = el;
            if (inputRef) inputRef.current = el;
          }}
          className={
            "prensa-input" +
            (isInvalid ? " invalida" : "") +
            (resuelto ? " veredicto-resuelto" : "")
          }
          inputMode="numeric"
          // "go" y no "done": Enter aquí ENVÍA el intento (submit del form).
          enterKeyHint="go"
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          placeholder={t("cdd.yearPlaceholder")}
          value={value || ""}
          readOnly={resuelto}
          aria-readonly={resuelto || undefined}
          onFocus={() => {
            if (resuelto) return;
            // En táctil-web sube el campo sobre el teclado; en la app no hace
            // nada, que es lo correcto (ver lib/teclado.js y el modo escritura).
            acercarCampoAlTeclado(innerRef.current);
          }}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, "").slice(0, 4);
            onChange(d ? parseInt(d, 10) : "");
          }}
          onWheel={(e) => e.currentTarget.blur()}
        />
        {resuelto && (
          <span className="prensa-campo-marca bien" aria-hidden="true">✓</span>
        )}
      </div>
      {horquillaTexto && (
        <p className="prensa-horquilla" aria-live="polite">{horquillaTexto}</p>
      )}
    </div>
  );
}
