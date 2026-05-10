// src/components/Autocomplete.jsx
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
        }}
        onBlur={scheduleClose}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="
          h-11 w-full min-w-0 rounded-lg border border-border-strong
          bg-bg-secondary px-3 text-sm text-white outline-none transition-colors
          placeholder:text-muted focus:border-accent
          disabled:cursor-not-allowed disabled:opacity-40
        "
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