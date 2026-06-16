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

  // Markup calcado del v0: stepper con − a la izquierda, número centrado y + a la
  // derecha, dentro de un campo h-11 redondeado. Lógica (clamp, décadas, foco
  // móvil) intacta.
  return (
    <div className="relative flex flex-col gap-1.5">
      <span className="px-1 text-xs text-muted-foreground">
        {t("cdd.labelAnio")}{" "}
        <span className="text-muted-foreground/50">{t("cdd.yearTolerance", { n: tolerance })}</span>
      </span>
      <div className="flex h-11 items-center justify-between rounded-xl border border-border bg-bg-tertiary px-2 transition-colors focus-within:border-mint focus-within:ring-2 focus-within:ring-mint/40">
        {/* aria-label numérico explícito; el glifo visible es tipográfico. */}
        <button
          type="button"
          aria-label="-1"
          onClick={() => step(-1)}
          className="flex size-8 items-center justify-center rounded-lg text-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          −
        </button>
        <input
          ref={(el) => {
            innerRef.current = el;
            if (inputRef) inputRef.current = el;
          }}
          className="w-20 bg-transparent text-center font-mono text-base tabular-nums text-foreground outline-none placeholder:text-muted-foreground/50"
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
          className="flex size-8 items-center justify-center rounded-lg text-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          +
        </button>
      </div>
      {showDecades && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 flex gap-1.5 rounded-xl border border-border bg-card p-1.5 shadow-2xl shadow-black/60"
          role="group"
          aria-label={t("cdd.decadesAria")}
        >
          {DECADES.map((d) => (
            <button
              key={d}
              type="button"
              className="flex-1 rounded-lg bg-bg-tertiary py-1.5 text-center font-mono text-xs text-foreground transition-colors hover:bg-mint hover:text-mint-foreground"
              // mousedown prevenido: que el chip NO robe el foco del input.
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
  );
}
