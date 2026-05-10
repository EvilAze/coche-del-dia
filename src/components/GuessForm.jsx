// src/components/GuessForm.jsx
import { useEffect, useState } from "react";
import { CARS, MARCAS } from "../data/cars";
import Autocomplete from "./Autocomplete";

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1886;

export default function GuessForm({ onSubmit, disabled }) {
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [anio, setAnio] = useState("");
  const [shake, setShake] = useState(false);

  const modelOptions = CARS
    .filter((c) => {
      if (!marca.trim()) return true;
      return c.marca.toLowerCase() === marca.trim().toLowerCase();
    })
    .map((c) => c.modelo)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();

  useEffect(() => {
    setModelo("");
  }, [marca]);

  function handleSubmit(e) {
    e.preventDefault();

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
      <div
        className={`
          flex w-full min-w-0 flex-col gap-y-3
          md:flex-row md:items-end md:gap-x-2
          ${shake ? "animate-shake" : ""}
        `}
      >
        <label className="flex w-full min-w-0 flex-col gap-1 md:flex-1">
          <span className="px-1 text-[10px] uppercase tracking-widest text-muted">
            Marca
          </span>
          <Autocomplete
            id="input-marca"
            value={marca}
            onChange={setMarca}
            onSelect={setMarca}
            options={MARCAS}
            placeholder="Escribe una marca..."
            disabled={disabled}
          />
        </label>

        <label className="flex w-full min-w-0 flex-col gap-1 md:flex-1">
          <span className="px-1 text-[10px] uppercase tracking-widest text-muted">
            Modelo
          </span>
          <Autocomplete
            id="input-modelo"
            value={modelo}
            onChange={setModelo}
            onSelect={setModelo}
            options={modelOptions}
            placeholder={
              marca && MARCAS.includes(marca)
                ? "Escribe un modelo..."
                : "Elige marca primero"
            }
            disabled={disabled || !MARCAS.includes(marca)}
          />
        </label>

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
