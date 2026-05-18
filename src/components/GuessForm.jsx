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

// Steppers verticales (▲/▼) anclados al borde derecho del input de año.
// Reemplazan a los spinners nativos (inconsistentes entre browsers y
// minúsculos en móvil) por algo visible y táctil, manteniendo la altura
// total del input (h-11 = 44px → cada botón h-5.5). Color muted en reposo,
// accent al hover, para no robar protagonismo cuando el usuario está
// rellenando otros campos pero sí ser evidente al inspeccionar la zona.
function YearStepper({ onStep, disabled }) {
  const btn = `
    flex h-1/2 w-7 items-center justify-center
    text-muted/70 transition-colors duration-150
    hover:text-accent hover:bg-white/[0.04]
    disabled:cursor-not-allowed disabled:opacity-30
    disabled:hover:text-muted/70 disabled:hover:bg-transparent
  `;
  return (
    <div
      className="
        pointer-events-none absolute inset-y-0 right-0
        flex w-7 flex-col border-l border-border-strong/60
        [&>button]:pointer-events-auto
      "
      aria-hidden="true"
    >
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => onStep(1)}
        className={`${btn} rounded-tr-lg`}
        aria-label="Año +1"
      >
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 15l6-6 6 6" />
        </svg>
      </button>
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => onStep(-1)}
        className={`${btn} rounded-br-lg border-t border-border-strong/60`}
        aria-label="Año -1"
      >
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </div>
  );
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
  const fieldsEmpty = !marca || !modelo || !anio;
  const buttonDisabled = formDisabled || fieldsEmpty;

  return (
    <form onSubmit={handleSubmit} className="w-full min-w-0">
      <div
        className={`
          flex w-full min-w-0 flex-col gap-y-3
          md:flex-row md:items-start md:gap-x-2
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
          {/* Wrapper relative para anclar los steppers custom. El input mantiene
              [appearance:textfield] para suprimir los spinners nativos (que en
              Firefox aparecen como un chevron tenue) y dejamos sitio (pr-7) a
              la derecha para los botones +/-. */}
          <div className="relative">
            <input
              type="number"
              inputMode="numeric"
              pattern="\d*"
              value={anio}
              onChange={(e) => setAnio(e.target.value)}
              disabled={formDisabled}
              placeholder="ej. 2019"
              min={MIN_YEAR}
              max={CURRENT_YEAR}
              className="
                h-11 w-full min-w-0 rounded-lg border border-border-strong
                bg-bg-secondary pl-3 pr-7 text-sm text-white outline-none
                transition-colors focus:border-accent placeholder:text-muted
                disabled:cursor-not-allowed disabled:opacity-40
                [appearance:textfield]
                [&::-webkit-inner-spin-button]:appearance-none
                [&::-webkit-outer-spin-button]:appearance-none
              "
              style={{ colorScheme: "dark" }}
            />
            {/* Steppers ±1 con clamp al rango [MIN_YEAR, CURRENT_YEAR]. Si el
                input está vacío al pulsar, arrancamos en CURRENT_YEAR (el año
                más probable para coches modernos). Botones tipo `button` para
                que no envíen el form. */}
            <YearStepper
              disabled={formDisabled}
              onStep={(delta) => {
                const current = parseInt(anio, 10);
                const base = Number.isFinite(current) ? current : CURRENT_YEAR;
                const next = Math.min(
                  CURRENT_YEAR,
                  Math.max(MIN_YEAR, base + delta)
                );
                setAnio(String(next));
              }}
            />
          </div>
          <span className="mt-0.5 block px-1 text-[9px] leading-tight text-muted/55">
            ±2 años aceptados
          </span>
        </label>
      </div>

      <button
        type="submit"
        disabled={buttonDisabled}
        aria-busy={isSubmitting}
        aria-live="polite"
        className={`
          mt-3 h-12 w-full rounded-lg bg-accent
          font-display text-lg tracking-widest text-bg-primary
          transition-all duration-150
          ${isSubmitting
            ? "cursor-wait opacity-80"
            : buttonDisabled
            ? "cursor-not-allowed opacity-30"
            : "hover:bg-accent-dark active:scale-[0.98]"}
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
