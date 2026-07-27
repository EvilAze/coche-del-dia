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
// Además de los estados de veredicto que comparte con Combo (resuelto/
// descartado), este campo lleva LA HORQUILLA: el rango que sigue vivo según las
// flechas ↑/↓ acumuladas. Es la pieza que sustituye al historial durante la
// partida — marca y modelo no lo necesitan porque el combo elimina de la lista
// lo ya fallado, pero el año no se elimina de ningún sitio.

import { useId, useRef } from "react";
import { useT } from "../../i18n";
import { Icon, I } from "./icons";

const MIN_YEAR = 1886;
const MAX_YEAR = new Date().getFullYear();

// inputRef: expone el <input> para la cadena de foco del formulario (al elegir
// modelo, el foco salta aquí y el teclado pasa a numérico solo).
export default function YearField({
  value,
  onChange,
  tolerance,
  inputRef = null,
  // Veredicto en el propio campo (ver el bloque largo de Combo.jsx).
  estado = null,
  bloqueado = false,
  valorVeredicto = null,
  // Dirección del último fallo ("up" | "down"): hacia dónde está el año real.
  direccion = null,
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
            (resuelto ? " veredicto-resuelto" : "") +
            (valorVeredicto ? " con-veredicto" : "")
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
        {/* Capa del veredicto de fallo: la cifra intentada, tachada, sobre el
            campo ya vacío (ver el porqué en Combo.jsx). */}
        {valorVeredicto && (
          <span className="prensa-veredicto veredicto-descartado" aria-hidden="true">
            {valorVeredicto}
          </span>
        )}
        {resuelto ? (
          <span className="prensa-campo-marca bien" aria-hidden="true">✓</span>
        ) : (
          // La flecha del último fallo se queda con el campo (no es efímera como
          // el valor tachado): dice hacia dónde seguir buscando y se usa en el
          // intento siguiente. El sentido va al lector de pantalla por la
          // horquilla de abajo, así que aquí es decorativa.
          direccion && (
            <span className="prensa-campo-marca dir" aria-hidden="true">
              <Icon d={direccion === "up" ? I.arrowU : I.arrowD} size={13} />
            </span>
          )
        )}
      </div>
      {horquillaTexto && (
        <p className="prensa-horquilla" aria-live="polite">{horquillaTexto}</p>
      )}
    </div>
  );
}
