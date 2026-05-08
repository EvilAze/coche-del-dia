// src/components/GuessForm.jsx
import { useState, useEffect } from "react";
import { CARS, MARCAS } from "../data/cars";

export default function GuessForm({ onSubmit, disabled }) {
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [anio, setAnio] = useState("");
  const [shake, setShake] = useState(false);

  const modelOptions = CARS
    .filter((c) => !marca || c.marca === marca)
    .map((c) => c.modelo)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();

  // Reset modelo if brand changes and current modelo not valid
  useEffect(() => {
    if (marca && modelo && !modelOptions.includes(modelo)) {
      setModelo("");
    }
  }, [marca]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!marca || !modelo || !anio) {
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      {/* Column headers */}
      <div className="grid gap-1.5" style={{ gridTemplateColumns: "1fr 1fr 76px" }}>
        <span className="text-[10px] tracking-widest uppercase text-muted px-1">Marca</span>
        <span className="text-[10px] tracking-widest uppercase text-muted px-1">Modelo</span>
        <span className="text-[10px] tracking-widest uppercase text-muted px-1">Año</span>
      </div>

      {/* Inputs */}
      <div
        className={`grid gap-1.5 ${shake ? "animate-shake" : ""}`}
        style={{ gridTemplateColumns: "1fr 1fr 76px" }}
      >
        {/* Marca select */}
        <select
          value={marca}
          onChange={(e) => setMarca(e.target.value)}
          disabled={disabled}
          className="
            bg-bg-secondary border border-border-strong rounded-lg px-3 h-11
            text-white text-sm font-body outline-none transition-colors
            focus:border-accent disabled:opacity-40 disabled:cursor-not-allowed
            appearance-none cursor-pointer
          "
          style={{ colorScheme: "dark" }}
        >
          <option value="">Marca…</option>
          {MARCAS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        {/* Modelo select — dependiente de Marca */}
        <select
          value={modelo}
          onChange={(e) => setModelo(e.target.value)}
          disabled={disabled || !marca}
          className="
            bg-bg-secondary border border-border-strong rounded-lg px-3 h-11
            text-white text-sm font-body outline-none transition-colors
            focus:border-accent appearance-none cursor-pointer
            disabled:opacity-40 disabled:cursor-not-allowed
          "
          style={{ colorScheme: "dark" }}
        >
          <option value="">{marca ? "Modelo…" : "← Elige marca"}</option>
          {modelOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        {/* Year input */}
        <input
          type="number"
          value={anio}
          onChange={(e) => setAnio(e.target.value)}
          disabled={disabled}
          placeholder="Año"
          min="1950"
          max="2025"
          className="
            bg-bg-secondary border border-border-strong rounded-lg px-3 h-11
            text-white text-sm font-body outline-none transition-colors
            focus:border-accent placeholder:text-muted
            disabled:opacity-40 disabled:cursor-not-allowed
            [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
            [&::-webkit-inner-spin-button]:appearance-none
          "
          style={{ colorScheme: "dark" }}
        />
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={disabled}
        className="
          w-full h-12 rounded-lg font-display text-lg tracking-widest
          bg-accent text-bg-primary transition-all duration-150
          hover:bg-accent-dark active:scale-[0.98]
          disabled:bg-border-strong disabled:text-muted disabled:cursor-not-allowed
        "
      >
        ADIVINAR
      </button>
    </form>
  );
}
