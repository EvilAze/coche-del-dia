// src/components/GuessForm.jsx
import { useEffect, useState } from "react";
import { CARS, MARCAS } from "../data/cars";
import Autocomplete from "./Autocomplete";

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1886; // Karl Benz patenta el primer automóvil

export default function GuessForm({ onSubmit, disabled }) {
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [anio, setAnio] = useState("");
  const [shake, setShake] = useState(false);

  // Opciones de modelo filtradas según la marca escrita
  const modelOptions = CARS
    .filter((c) => {
      if (!marca.trim()) return true;
      // Filtrar si la marca escrita coincide exactamente con alguna del array
      // (ya que el usuario puede haber escrito solo parte)
      return c.marca.toLowerCase() === marca.trim().toLowerCase();
    })
    .map((c) => c.modelo)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();

  // Si cambia la marca y el modelo actual ya no pertenece a ella
  useEffect(() => {
    if (modelo && !modelOptions.includes(modelo)) {
      setModelo("");
    }
  }, [marca, modelo, modelOptions]);

  function handleSubmit(e) {
    e.preventDefault();

    // Validar que los valores sean exactos (no texto a medias)
    const marcaValida = MARCAS.includes(marca);
    const modeloValido = CARS.some(
      (c) => c.modelo === modelo && c.marca === marca
    );
    const anioNum = parseInt(anio);
    const anioValido =
      !isNaN(anioNum) && anioNum >= MIN_YEAR && anioNum <= CURRENT_YEAR;

    if (!marcaValida || !modeloValido || !anioValido) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      return;
    }

    onSubmit(marca, modelo, anio);
    setMarca("");
    setModelo("");
    setAnio("");
  }

  return (
    <form onSubmit={handleSubmit} className="w-full min-w-0">
      {/* Campos — apilados en móvil, en fila en md+ */}
      <div
        className={`
          flex w-full min-w-0 flex-col gap-y-3
          md:flex-row md:items-end md:gap-x-2
          ${shake ? "animate-shake" : ""}
        `}
      >
        {/* ── MARCA ──────────────────────────────────────────────── */}
        <label className="flex w-full min-w-0 flex-col gap-1 md:flex-1">
          <span className="px-1 text-[10px] uppercase tracking-widest text-muted">
            Marca
          </span>
          <Autocomplete
            id="input-marca"
            value={marca}
            onChange={(val) => setMarca(val)}
            onSelect={(val) => setMarca(val)}
            options={MARCAS}
            placeholder="Escribe una marca…"
            disabled={disabled}
          />
        </label>

        {/* ── MODELO ─────────────────────────────────────────────── */}
        <label className="flex w-full min-w-0 flex-col gap-1 md:flex-1">
          <span className="px-1 text-[10px] uppercase tracking-widest text-muted">
            Modelo
          </span>
          <Autocomplete
            id="input-modelo"
            value={modelo}
            onChange={(val) => setModelo(val)}
            onSelect={(val) => setModelo(val)}
            options={modelOptions}
            placeholder={
              marca && MARCAS.includes(marca)
                ? "Escribe un modelo…"
                : "Elige marca primero"
            }
            disabled={disabled || !MARCAS.includes(marca)}
          />
        </label>

        {/* ── AÑO ────────────────────────────────────────────────── */}
        <label className="flex w-full min-w-0 flex-col gap-1 md:w-24 md:shrink-0">
          <span className="px-1 text-[10px] uppercase tracking-widest text-muted">
            Año
          </span>
          <input
            type="number"
            value={anio}
            onChange={(e) => setAnio(e.target.value)}
            disabled={disabled}
            placeholder="Año"
            min={MIN_YEAR}
            max={CURRENT_YEAR}
            className="
              h-11 w-full min-w-0 rounded-lg border border-border-strong
              bg-bg-secondary px-3 text-sm text-white outline-none
              transition-colors focus:border-accent placeholder:text-muted
              disabled:cursor-not-allowed disabled:opacity-40
              [appearance:textfield]
              [&::-webkit-inner-spin-button]:appearance-none
              [&::-webkit-outer-spin-button]:appearance-none
            "
            style={{ colorScheme: "dark" }}
          />
        </label>
      </div>

      {/* ── BOTÓN ──────────────────────────────────────────────────── */}
      <button
        type="submit"
        disabled={disabled}
        className="
          mt-3 h-12 w-full rounded-lg bg-accent
          font-display text-lg tracking-widest text-bg-primary
          transition-all duration-150 hover:bg-accent-dark active:scale-[0.98]
          disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-muted
        "
      >
        ADIVINAR
      </button>
    </form>
  );
}