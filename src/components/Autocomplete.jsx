// src/components/Autocomplete.jsx
// Componente de buscador predictivo reutilizable con tema oscuro.
// Props:
//   value        — string: valor actual del input
//   onChange     — fn(string): se llama al escribir
//   onSelect     — fn(string): se llama al elegir una opción de la lista
//   options      — string[]: lista completa de opciones posibles
//   placeholder  — string
//   disabled     — bool
//   id           — string (para el label htmlFor)

import { useEffect, useRef, useState } from "react";

export default function Autocomplete({
  value,
  onChange,
  onSelect,
  options = [],
  placeholder = "",
  disabled = false,
  id,
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Filtrar opciones según lo escrito.
// No recortamos la lista: el scroll del dropdown debe permitir llegar a todas.
const filtered = value.trim()
  ? options.filter((o) =>
      o.toLowerCase().includes(value.trim().toLowerCase())
    )
  : options;

  // Cerrar al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Hacer scroll al item resaltado
  useEffect(() => {
    if (listRef.current) {
      const item = listRef.current.children[highlighted];
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [highlighted]);

  function handleInputChange(e) {
    onChange(e.target.value);
    setHighlighted(0);
    setOpen(true);
  }

  function handleSelect(option) {
    onSelect(option);
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") setOpen(true);
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

  const inputClass = `
    h-11 w-full min-w-0 rounded-lg border border-border-strong
    bg-bg-secondary px-3 text-sm text-white outline-none transition-colors
    placeholder:text-muted
    focus:border-accent
    disabled:cursor-not-allowed disabled:opacity-40
  `;

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={handleInputChange}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className={inputClass}
      />

      {/* Dropdown */}
      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          role="listbox"
          className="
  absolute left-0 right-0 z-[9999] mt-1
  max-h-[min(18rem,45vh)] overflow-y-auto overscroll-contain
  scroll-py-2 rounded-lg border border-border-strong
  bg-bg-secondary pb-2 shadow-xl shadow-black/50
  [-webkit-overflow-scrolling:touch]
"
        >
          {filtered.map((option, i) => {
            // Resaltar la parte del texto que coincide con la búsqueda
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
                onMouseDown={(e) => {
                  // mousedown en vez de click para que no dispare onBlur antes
                  e.preventDefault();
                  handleSelect(option);
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={`
                  cursor-pointer px-3 py-2.5 text-sm transition-colors
                  ${i === highlighted
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