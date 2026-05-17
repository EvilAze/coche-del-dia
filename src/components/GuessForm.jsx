// src/components/GuessForm.jsx
import { useEffect, useMemo, useState } from "react";
import { useCatalog } from "../data/catalog";
import Autocomplete from "./Autocomplete";

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1886;

function triggerHaptic(pattern) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern);
  }
}

function Spinner() {
  return (
    <svg
      className="h-5 w-5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        className="opacity-25"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="opacity-90"
      />
    </svg>
  );
}

export default function GuessForm({ onSubmit, isSubmitting = false }) {
  const { data: catalog } = useCatalog();
  const CARS = catalog?.cars ?? [];
  const MARCAS = catalog?.marcas ?? [];

  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [anio, setAnio] = useState("");
  const [shake, setShake] = useState(false);

  const marcaValidaSeleccionada = MARCAS.includes(marca);

  // ANTI-CHEAT: hasta que el usuario no elija una marca válida del catálogo,
  // NO devolvemos ningún modelo. Antes devolvíamos toda la lista de modelos
  // (filtrado vacío → return true para todos), lo que permitía:
  //   1. Memorizar/fotografiar la lista completa del catálogo.
  //   2. Escribir el nombre del modelo del día (p.ej. "Stradale") y ver al
  //      instante a qué coche pertenece, anulando el reto.
  //   3. Deducir por eliminación entre intentos.
  // La consecuencia visible para el usuario: el campo Modelo está deshabilitado
  // hasta que selecciona una Marca válida (ver `disabled` más abajo).
  const modelOptions = useMemo(() => {
    if (!marcaValidaSeleccionada) return [];
    return CARS
      .filter((c) => c.marca === marca)
      .map((c) => c.modelo)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort();
  }, [CARS, marca, marcaValidaSeleccionada]);

  useEffect(() => {
    if (!modelo || !marcaValidaSeleccionada) return;

    const modeloPerteneceAMarca = CARS.some(
      (c) => c.marca === marca && c.modelo === modelo
    );

    if (!modeloPerteneceAMarca) {
      setModelo("");
    }
    // Solo debe reaccionar a cambios de marca. Si depende de "modelo",
    // se borraría mientras el usuario escribe texto parcial.
  }, [marca]);

  async function handleSubmit(e) {
    e.preventDefault();

    if (isSubmitting) return;
    // Si el catálogo aún no ha llegado, no aceptamos intentos.
    if (!catalog) return;

    const submittedMarca = marca;
    const submittedModelo = modelo;
    const submittedAnio = anio;

    const marcaValida = MARCAS.includes(submittedMarca);
    const guessCar = CARS.find(
      (c) => c.modelo === submittedModelo && c.marca === submittedMarca
    );
    const modeloValido = Boolean(guessCar);
    const anioNum = parseInt(submittedAnio);
    const anioValido =
      !isNaN(anioNum) && anioNum >= MIN_YEAR && anioNum <= CURRENT_YEAR;

    if (!marcaValida || !modeloValido || !anioValido) {
      triggerHaptic(30);
      setShake(true);
      setTimeout(() => setShake(false), 500);
      return;
    }

    triggerHaptic(50);

    // Enviamos el id del coche elegido en el autocompletado en vez del par
    // marca/modelo en texto: así el servidor valida directamente contra una
    // fila concreta del catálogo y no tiene que confiar en strings cliente.
    const result = await onSubmit({
      guessCarId: guessCar.id,
      anio: submittedAnio,
    });

    if (!result) return;

    setMarca(result.marca.status === "correct" ? submittedMarca : "");
    setModelo(result.modelo.status === "correct" ? submittedModelo : "");
    setAnio(result.anio.status === "correct" ? submittedAnio : "");
  }

  const formDisabled = isSubmitting || !catalog;

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
            placeholder=""
            disabled={formDisabled}
          />
        </label>

        <label className="flex w-full min-w-0 flex-col gap-1 md:flex-1">
          <span className="px-1 text-[10px] uppercase tracking-widest text-muted">
            Modelo
          </span>
          {/*
            Modelo bloqueado hasta que haya marca válida (ANTI-CHEAT).
            El placeholder explica el "por qué" — sin esto, un usuario que
            empieza por Modelo se quedaría confundido sin entender que
            primero tiene que elegir Marca.
          */}
          <Autocomplete
            id="input-modelo"
            value={modelo}
            onChange={setModelo}
            onSelect={setModelo}
            options={modelOptions}
            placeholder={marcaValidaSeleccionada ? "" : "Elige marca primero"}
            disabled={formDisabled || !marcaValidaSeleccionada}
          />
        </label>

        <label className="flex w-full min-w-0 flex-col gap-1 md:w-24 md:shrink-0">
          <span className="px-1 text-[10px] uppercase tracking-widest text-muted">
            Año
          </span>
          <input
            type="number"
            inputMode="numeric"
            pattern="\d*"
            value={anio}
            onChange={(e) => setAnio(e.target.value)}
            disabled={formDisabled}
            placeholder=""
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
        disabled={formDisabled}
        aria-busy={isSubmitting}
        aria-live="polite"
        className={`
          mt-3 h-12 w-full rounded-lg bg-accent
          font-display text-lg tracking-widest text-bg-primary
          transition-all duration-150 active:scale-[0.98]
          ${isSubmitting
            ? "cursor-wait opacity-80"
            : "hover:bg-accent-dark"}
        `}
      >
        {isSubmitting ? (
          <span className="inline-flex items-center justify-center gap-2">
            <Spinner />
            COMPROBANDO
          </span>
        ) : (
          "ADIVINAR"
        )}
      </button>
    </form>
  );
}
