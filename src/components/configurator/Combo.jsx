// src/components/configurator/Combo.jsx
// Combobox del configurador (marca / modelo). Port del Combo del prototipo, con
// las mejoras de UX del Autocomplete de producción: filtrado sin acentos,
// navegación por teclado, banderas opcionales por opción, scroll táctil del
// desplegable y auto-scroll del input en móvil (que no quede tras el teclado).

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { haptic } from "../../lib/haptics";
import { acercarCampoAlTeclado } from "../../lib/teclado";
import { normalizar } from "../../lib/texto";
import { useT } from "../../i18n";

// La normalización vive en lib/texto: la comparten este combo (web) y la hoja
// de selección (app), y dos copias acabarían divergiendo en el caso raro — la
// marca con diéresis que se escribe sin ella.
const norm = normalizar;

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
  // ── VEREDICTO EN EL PROPIO CAMPO ──────────────────────────────────────────
  // El resultado del intento dejó de vivir en una fila aparte («último intento»)
  // y se estampa aquí, sobre el renglón donde se escribió. Tres estados:
  //   · "resuelto"   → acertado. Valor + ✓ y campo BLOQUEADO: no se vuelve a
  //                    teclear en toda la partida. El formulario encoge de 3
  //                    campos a 2 a 1 según aciertas.
  //
  // Hubo dos estados más ("descartado" y "cerca") con su capa de veredicto
  // encima del input —el valor tachado a pluma y la bandera del «mismo país»—.
  // Se retiraron al simplificar el cupón: ese acuse de recibo vive ahora en el
  // historial, que por eso volvió a pintarse también en móvil.
  estado = null,
  bloqueado = false,
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
    // Campo resuelto: ni desplegable ni auto-scroll. Es un dato ya cerrado, no
    // un renglón por rellenar — abrirle la lista invitaría a cambiar algo que
    // no se puede cambiar. (`resuelto` se declara abajo; para cuando el usuario
    // puede enfocar, el render ya lo ha inicializado.)
    if (disabled || resuelto) return;
    setOpen(true);
    // Subir el campo sobre el teclado es cosa de la WEB. En la app lo resuelve
    // la composición (el cupón ya nace pegado al teclado), y desplazar aquí
    // movería un shell que por diseño no se mueve. La decisión vive en
    // lib/teclado.js para que haya un solo sitio que sepa de teclados.
    acercarCampoAlTeclado(innerRef.current);
  }

  function onKey(e) {
    if (resuelto) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter" && open && filtered[hi]) { e.preventDefault(); choose(filtered[hi]); }
    else if (e.key === "Escape") setOpen(false);
  }

  // Piel «Prensa del motor»: label en versalitas + input de LÍNEA BASE (el
  // renglón de un formulario impreso; lo escrito sale "a máquina" en Courier)
  // + listbox de papel con filete. La lógica (autocomplete, anti-cheat,
  // banderas, teclado) es la misma; solo cambia la piel.
  // El campo resuelto sale del flujo de edición por completo: readOnly (no
  // `disabled`, que lo sacaría del árbol accesible y del tab-order sin decir por
  // qué) y sin desplegable. El lector de pantalla anuncia el valor y su estado.
  const resuelto = estado === "resuelto" || bloqueado;

  return (
    <div className="relative flex flex-col gap-0.5" ref={ref}>
      <label htmlFor={inputId} className="prensa-label">
        {label}
        {resuelto && <span className="pista-label resuelta">{t("cdd.fieldSolved")}</span>}
      </label>
      <div className="prensa-campo">
        <input
          id={inputId}
          ref={setInputRef}
          className={
            "prensa-input" +
            (invalid && !open ? " invalida" : "") +
            (resuelto ? " veredicto-resuelto" : "")
          }
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
          readOnly={resuelto}
          aria-readonly={resuelto || undefined}
          placeholder={placeholder}
          onChange={(e) => { onChange(""); setQ(e.target.value); setOpen(true); }}
          onFocus={onFocus}
          onKeyDown={onKey}
        />
        {/* El ✓ del campo resuelto vive FUERA del input (un <input> no admite
            hijos) pero dentro de su renglón, a la derecha y sin capturar el
            toque: el objetivo táctil sigue siendo el campo entero. */}
        {resuelto && (
          <span className="prensa-campo-marca bien" aria-hidden="true">✓</span>
        )}
      </div>
      {open && !disabled && !resuelto && (
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
