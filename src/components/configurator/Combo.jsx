// src/components/configurator/Combo.jsx
// Combobox del configurador (marca / modelo). Port del Combo del prototipo, con
// las mejoras de UX del Autocomplete de producción: filtrado sin acentos,
// navegación por teclado, banderas opcionales por opción, scroll táctil del
// desplegable y auto-scroll del input en móvil (que no quede tras el teclado).

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { haptic } from "../../lib/haptics";
import { useT } from "../../i18n";

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
  // Cadena de foco (marca→modelo→año): el padre nos pasa un ref para poder
  // enfocar este input programáticamente, y un onCommit que disparamos al
  // elegir una opción REAL (no al teclear) para que avance al siguiente campo.
  // enterKeyHint deja que el teclado móvil muestre "siguiente" en marca/modelo
  // en vez de la lupa.
  inputRef = null,
  onCommit = null,
  enterKeyHint = "search",
}) {
  const { t } = useT();
  // id estable para asociar <label> ↔ <input> (a11y: el lector de pantalla
  // anuncia "Marca"/"Modelo" y tocar la etiqueta enfoca el campo).
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef(null);
  const innerRef = useRef(null);
  const listRef = useRef(null);

  // Ref combinado: mantenemos el ref interno (lo usamos para el auto-scroll en
  // móvil) y, si el padre pasó inputRef, lo sincronizamos para que pueda
  // enfocar el input desde la cadena de foco.
  const setInputRef = (node) => {
    innerRef.current = node;
    if (typeof inputRef === "function") inputRef(node);
    else if (inputRef) inputRef.current = node;
  };

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

  // Si el padre confirma un valor (selección o canonización del resolver en
  // el submit), el borrador tecleado deja de tener sentido: limpiarlo evita
  // que reaparezca al borrar el valor después.
  useEffect(() => { if (value) setQ(""); }, [value]);

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
    // Avanza la cadena de foco al siguiente campo (lo gestiona el padre, que
    // sabe cuál es y espera al frame siguiente por si acaba de habilitarse).
    onCommit?.();
  }

  function onFocus() {
    if (disabled) return;
    setOpen(true);
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
    if (coarse) {
      window.setTimeout(() => {
        innerRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      }, 280);
    }
  }

  function onKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter" && open && filtered[hi]) { e.preventDefault(); choose(filtered[hi]); }
    else if (e.key === "Escape") setOpen(false);
  }

  // Piel «Prensa del motor»: label en versalitas + input de LÍNEA BASE (el
  // renglón de un formulario impreso; lo escrito sale "a máquina" en Courier)
  // + listbox de papel con filete. La lógica (autocomplete, anti-cheat,
  // banderas, teclado) es la misma; solo cambia la piel.
  return (
    <div className="relative flex flex-col gap-1.5" ref={ref}>
      <label htmlFor={inputId} className="prensa-label">{label}</label>
      <input
        id={inputId}
        ref={setInputRef}
        className={"prensa-input" + (invalid && !open ? " invalida" : "")}
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
      {open && !disabled && (
        <ul className="prensa-listbox" role="listbox" ref={listRef}>
          {filtered.length === 0 && (
            <li className="prensa-opt vacia">{t("cdd.noMatches")}</li>
          )}
          {filtered.map((o, i) => {
            const flag = optionFlag ? optionFlag(o) : null;
            return (
              <li
                key={o}
                role="option"
                aria-selected={o === value}
                className={"prensa-opt" + (i === hi ? " hi" : "")}
                onMouseEnter={() => setHi(i)}
                onClick={() => choose(o)}
              >
                <span>{o}</span>
                {flag && <img className="bandera" src={flag} alt="" draggable={false} loading="lazy" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
