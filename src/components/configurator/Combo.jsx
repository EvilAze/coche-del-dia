// src/components/configurator/Combo.jsx
// Combobox del configurador (marca / modelo). Port del Combo del prototipo, con
// las mejoras de UX del Autocomplete de producción: filtrado sin acentos,
// navegación por teclado, banderas opcionales por opción, scroll táctil del
// desplegable y auto-scroll del input en móvil (que no quede tras el teclado).

import { useEffect, useMemo, useRef, useState } from "react";
import { haptic } from "../../lib/haptics";
import { useT } from "../../i18n";
import { Icon, I } from "./icons";

const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(DIACRITICS, "");

export default function Combo({
  label,
  hint,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  invalid = false,
  optionFlag = null,
  // Cadena de foco del formulario (marca→modelo→año): onPick avisa de una
  // SELECCIÓN real (no de tecleo) para que el padre mueva el foco al campo
  // siguiente; inputRef expone el <input> para recibir ese foco; enterKeyHint
  // pinta la tecla de acción del teclado móvil acorde al paso ("next"/"go").
  onPick = null,
  inputRef: externalInputRef = null,
  enterKeyHint = "search",
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Texto visible: el valor elegido, o lo que el usuario está tecleando.
  const text = value || q;
  // Sin recorte: hay más de 80 marcas, así que un `.slice(0, 80)` cortaba la
  // lista alfabética por la "R" y ocultaba todo lo posterior (Seat, Tesla,
  // Volkswagen…). La lista es acotada (marcas/modelos) y el desplegable ya
  // hace scroll, así que renderizamos todas las coincidencias (como el
  // Autocomplete de producción).
  const filtered = useMemo(() => {
    const needle = norm(value ? "" : q);
    return options.filter((o) => norm(o).includes(needle));
  }, [q, value, options]);

  useEffect(() => { setHi(0); }, [q, value, open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[hi];
    el?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, []);

  function choose(o) {
    haptic.selection();
    onChange(o);
    setQ("");
    setOpen(false);
    onPick?.(o);
  }

  function onFocus() {
    if (disabled) return;
    setOpen(true);
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
    if (coarse) {
      window.setTimeout(() => {
        inputRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      }, 280);
    }
  }

  function onKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter" && open && filtered[hi]) { e.preventDefault(); choose(filtered[hi]); }
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div className="cdd-field" ref={ref}>
      <label className="cdd-label cdd-mono">
        {label}
        {hint && <span className="cdd-label-hint">{hint}</span>}
      </label>
      <div className={"cdd-combo" + (disabled ? " is-disabled" : "") + (open ? " is-open" : "") + (invalid && !open ? " is-invalid" : "")}>
        <input
          ref={(el) => {
            inputRef.current = el;
            if (externalInputRef) externalInputRef.current = el;
          }}
          className="cdd-input"
          type="search"
          enterKeyHint={enterKeyHint}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => { onChange(""); setQ(e.target.value); setOpen(true); }}
          onFocus={onFocus}
          onKeyDown={onKey}
        />
        <button
          type="button"
          className="cdd-combo-caret"
          disabled={disabled}
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => !disabled && setOpen((o) => !o)}
        >
          <Icon d={I.chevD} size={18} />
        </button>
        {open && !disabled && (
          <ul className="cdd-listbox" role="listbox" ref={listRef}>
            {filtered.length === 0 && <li className="cdd-opt cdd-opt-empty">{t("cdd.noMatches")}</li>}
            {filtered.map((o, i) => {
              const flag = optionFlag ? optionFlag(o) : null;
              return (
                <li
                  key={o}
                  role="option"
                  aria-selected={o === value}
                  className={"cdd-opt" + (o === value ? " sel" : "") + (i === hi ? " hi" : "")}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => choose(o)}
                >
                  <span>{o}</span>
                  {flag && <img className="cdd-flag" src={flag} alt="" draggable={false} loading="lazy" />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
