// src/components/Autocomplete.jsx
import { useEffect, useRef, useState } from "react";
import { haptic } from "../lib/haptics";

export default function Autocomplete({
  value,
  onChange,
  onSelect,
  options = [],
  placeholder = "",
  disabled = false,
  id,
  // Si true, pinta el input con borde rojo SOLO cuando está fuera de foco
  // (el dropdown cerrado). La idea: mientras el usuario tipea, no le damos
  // feedback negativo — quizá está a medio escribir. Solo cuando ya ha
  // dejado el campo y el texto no coincide con ninguna opción exacta,
  // marcamos visualmente "esto no es válido, vuelve y selecciona".
  invalid = false,
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const closeTimeoutRef = useRef(null);
  const selectingRef = useRef(false);

  const filtered = value.trim()
    ? options.filter((o) =>
        o.toLowerCase().includes(value.trim().toLowerCase())
      )
    : options;

  useEffect(() => {
    function handleClickOutside(e) {
      if (!containerRef.current?.contains(e.target)) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = window.setTimeout(() => {
          if (!selectingRef.current) setOpen(false);
        }, 180);
      }
    }

    document.addEventListener("click", handleClickOutside);

    return () => {
      document.removeEventListener("click", handleClickOutside);
      window.clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const item = listRef.current?.children[highlighted];
    item?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  function scheduleClose() {
    window.clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = window.setTimeout(() => {
      if (!selectingRef.current) setOpen(false);
    }, 180);
  }

  function cancelScheduledClose() {
    window.clearTimeout(closeTimeoutRef.current);
  }

  function handleInputChange(e) {
    selectingRef.current = false;
    onChange(e.target.value);
    setHighlighted(0);
    setOpen(true);
  }

  function handleSelect(option) {
    selectingRef.current = true;
    cancelScheduledClose();

    haptic.selection();
    onSelect(option);
    setOpen(false);
    setHighlighted(0);

    requestAnimationFrame(() => {
      setOpen(false);
      inputRef.current?.blur();
      selectingRef.current = false;
    });
  }

  function handleKeyDown(e) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlighted]) handleSelect(filtered[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full min-w-0"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={handleInputChange}
        onFocus={() => {
          if (selectingRef.current) return;
          cancelScheduledClose();
          setHighlighted(0);
          setOpen(true);
          // Móvil: el desplegable abre DEBAJO del input y, si el campo está
          // bajo (p.ej. Modelo), queda tras el teclado. Subimos el input hacia
          // arriba para que el dropdown quepa sobre el teclado. Solo en táctil
          // (en desktop sería un salto innecesario). El delay espera a que el
          // teclado termine de animar. `scroll-mt` (abajo) deja sitio al header
          // y a la etiqueta.
          const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
          if (coarse) {
            window.setTimeout(() => {
              inputRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
            }, 280);
          }
        }}
        onBlur={scheduleClose}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        // enterKeyHint="search": en móvil el teclado muestra una lupa en
        // vez del genérico "↵". Coherente con que el input filtra una lista.
        enterKeyHint="search"
        // Evita que 1Password / LastPass / Bitwarden inyecten su icono
        // sobre el input — pensaban que era un campo de username.
        data-1p-ignore="true"
        data-lpignore="true"
        className={`
          focus-ring scroll-mt-24
          h-11 w-full min-w-0 rounded-lg border
          bg-bg-secondary px-3 text-sm text-white transition-colors
          shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]
          placeholder:text-muted/70 focus:border-accent
          enabled:hover:border-accent/40
          disabled:cursor-not-allowed disabled:opacity-40
          ${invalid && !open
            ? "border-red-500/70 bg-red-500/5"
            : "border-border-strong"}
        `}
      />

      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          role="listbox"
          className="
            absolute left-0 right-0 z-[9999] mt-1
            max-h-[40dvh] overflow-y-auto overscroll-contain touch-pan-y
            scroll-py-2 rounded-lg border border-border-strong
            bg-bg-secondary pb-2 shadow-xl shadow-black/50
            sm:max-h-72
            [-webkit-overflow-scrolling:touch]
          "
        >
          {filtered.map((option, i) => {
            const query = value.trim();
            const idx = option.toLowerCase().indexOf(query.toLowerCase());
            const before = option.slice(0, idx);
            const match = option.slice(idx, idx + query.length);
            const after = option.slice(idx + query.length);

            return (
              <li
                key={option}
                role="option"
                aria-selected={i === highlighted}
                onClick={() => handleSelect(option)}
                onMouseEnter={() => setHighlighted(i)}
                className={`
                  cursor-pointer px-3 py-2.5 text-sm transition-colors
                  touch-pan-y select-none
                  ${
                    i === highlighted
                      ? "bg-accent/15 text-white"
                      : "text-muted hover:bg-white/5 hover:text-white"
                  }
                  ${i < filtered.length - 1 ? "border-b border-border" : ""}
                `}
              >
                {query && idx !== -1 ? (
                  <>
                    {before}
                    <span className="font-semibold text-accent">{match}</span>
                    {after}
                  </>
                ) : (
                  option
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}