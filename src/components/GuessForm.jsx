import { useEffect, useState } from "react";
import { CARS, MARCAS } from "../data/cars";

function Field({ label, children }) {
  return (
    <label className="flex w-full min-w-0 flex-col gap-1">
      <span className="px-1 text-[10px] uppercase tracking-widest text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

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

  const controlClass = `
    box-border h-11 w-full min-w-0 rounded-lg border border-border-strong
    bg-bg-secondary px-3 text-sm text-white outline-none transition-colors
    focus:border-accent disabled:cursor-not-allowed disabled:opacity-40
  `;

  return (
  <form onSubmit={handleSubmit} className="w-full min-w-0">
    <div className={`flex w-full flex-col gap-y-3 md:flex-row md:gap-x-2 ${shake ? "animate-shake" : ""}`}>
      <label className="flex w-full min-w-0 flex-col gap-1 md:flex-1">
        <span className="px-1 text-[10px] uppercase tracking-widest text-muted">
          Marca
        </span>
        <select
          value={marca}
          onChange={(e) => setMarca(e.target.value)}
          disabled={disabled}
          className="
            h-11 w-full min-w-0 rounded-lg border border-border-strong
            bg-bg-secondary px-3 text-sm text-white outline-none
            transition-colors focus:border-accent
            disabled:cursor-not-allowed disabled:opacity-40
            appearance-none cursor-pointer
          "
          style={{ colorScheme: "dark" }}
        >
          <option value="">Marca...</option>
          {MARCAS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </label>

      <label className="flex w-full min-w-0 flex-col gap-1 md:flex-1">
        <span className="px-1 text-[10px] uppercase tracking-widest text-muted">
          Modelo
        </span>
        <select
          value={modelo}
          onChange={(e) => setModelo(e.target.value)}
          disabled={disabled || !marca}
          className="
            h-11 w-full min-w-0 rounded-lg border border-border-strong
            bg-bg-secondary px-3 text-sm text-white outline-none
            transition-colors focus:border-accent
            disabled:cursor-not-allowed disabled:opacity-40
            appearance-none cursor-pointer
          "
          style={{ colorScheme: "dark" }}
        >
          <option value="">{marca ? "Modelo..." : "Elige marca"}</option>
          {modelOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
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
          min="1950"
          max="2026"
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
