// src/components/GuessForm.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useCatalog } from "../data/catalog";
import { useT } from "../i18n";
import Autocomplete from "./Autocomplete";
import { useToast } from "./Toast";
import { haptic } from "../lib/haptics";

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1886;

// Steppers verticales (▲/▼) anclados al borde derecho del input de año.
// Reemplazan a los spinners nativos (inconsistentes entre browsers y
// minúsculos en móvil) por algo visible y táctil, manteniendo la altura
// total del input (h-11 = 44px → cada botón h-5.5). Color muted en reposo,
// accent al hover, para no robar protagonismo cuando el usuario está
// rellenando otros campos pero sí ser evidente al inspeccionar la zona.
function YearStepper({ onStep, disabled }) {
  const { t } = useT();
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
        aria-label={t("guess.yearStepperUp")}
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
        aria-label={t("guess.yearStepperDown")}
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

export default function GuessForm({ onSubmit, isSubmitting = false, guesses = [] }) {
  const { t } = useT();
  const toast = useToast();
  const { data: catalog } = useCatalog();
  const CARS = catalog?.cars ?? [];
  const MARCAS = catalog?.marcas ?? [];

  // Conjuntos de valores ya intentados sin éxito. Sirven para:
  //   - Quitar la marca del autocompletado (wrong y partial — partial es
  //     "país acertado" y reintentar la misma marca no aporta info nueva).
  //   - Quitar el modelo del autocompletado (mismo marca + modelo wrong).
  //   - Rechazar el año exacto en el submit (con feedback visual + toast).
  // Simplificamos la UX: si ya lo probaste y falló, no vuelves a perder un
  // intento con lo mismo.
  const triedWrongMarcas = useMemo(() => {
    const set = new Set();
    for (const g of guesses) {
      const st = g?.marca?.status;
      if ((st === "wrong" || st === "partial") && g.marca?.val) {
        set.add(g.marca.val.toLowerCase());
      }
    }
    return set;
  }, [guesses]);

  const triedWrongModelKeys = useMemo(() => {
    const set = new Set();
    for (const g of guesses) {
      if (g?.modelo?.status === "wrong" && g.modelo.val && g.marca?.val) {
        set.add(`${g.marca.val.toLowerCase()}|${g.modelo.val.toLowerCase()}`);
      }
    }
    return set;
  }, [guesses]);

  const triedWrongYears = useMemo(() => {
    const set = new Set();
    for (const g of guesses) {
      if (g?.anio?.status === "wrong" && g.anio.val != null) {
        set.add(String(g.anio.val));
      }
    }
    return set;
  }, [guesses]);

  // Lista de marcas disponibles en el autocompletado: catálogo sin las que
  // ya se intentaron sin éxito. Si después de filtrar no queda ninguna,
  // dejamos al menos la lista completa visible (caso patológico — no debería
  // pasar en la práctica con MAX_ATTEMPTS=5 y >100 marcas).
  const availableMarcas = useMemo(() => {
    if (triedWrongMarcas.size === 0) return MARCAS;
    const filtered = MARCAS.filter((m) => !triedWrongMarcas.has(m.toLowerCase()));
    return filtered.length > 0 ? filtered : MARCAS;
  }, [MARCAS, triedWrongMarcas]);

  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [anio, setAnio] = useState("");

  // Shake re-triggerable: si el usuario falla dos veces seguidas en menos
  // de la duración de la keyframe (0.4 s), el patrón anterior con
  // useState(true) + setTimeout(false) no re-disparaba la animación porque
  // React no detectaba cambio de valor (ya estaba true).
  //
  // Solución: ref al contenedor + manipulación directa de classList con un
  // force-reflow entre remove/add. Esto NO remonta los inputs hijos (que
  // perderían foco y blanquearían lo que el usuario está escribiendo) y
  // garantiza que cada fallo dispara la animación de cero.
  const shakeBoxRef = useRef(null);
  function triggerShake() {
    const el = shakeBoxRef.current;
    if (!el) return;
    el.classList.remove("animate-shake");
    // Force reflow: el navegador procesa la eliminación antes del add y
    // así el keyframe arranca limpio. Sin esto, el add inmediato es un
    // no-op visual cuando la clase ya estaba presente.
    void el.offsetWidth;
    el.classList.add("animate-shake");
  }

  const marcaValidaSeleccionada = MARCAS.includes(marca);
  // Feedback visual de "marca tecleada pero no seleccionada del dropdown".
  // p.ej. el usuario escribe "Ferra", hace click fuera y se va a otro campo
  // sin haber elegido "Ferrari" de la lista. Sin esta señal, ve el campo
  // Modelo deshabilitado pero no entiende por qué. El borde rojo en Marca
  // (solo cuando el campo NO tiene foco — el Autocomplete lo gestiona) le
  // dice "vuelve aquí y selecciona una opción de la lista".
  const marcaInvalida = marca.trim().length > 0 && !marcaValidaSeleccionada;
  // Mismo principio para Modelo: si la marca es válida pero el texto del
  // modelo no coincide con ningún modelo del catálogo de esa marca. Solo
  // tiene sentido cuando la marca ya es válida (sin marca, el campo está
  // disabled y el usuario no puede haber tecleado ahí).
  const modeloValidoSeleccionado =
    marcaValidaSeleccionada &&
    CARS.some((c) => c.marca === marca && c.modelo === modelo);
  const modeloInvalido =
    marcaValidaSeleccionada &&
    modelo.trim().length > 0 &&
    !modeloValidoSeleccionado;

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
    const marcaKey = marca.toLowerCase();
    return CARS
      .filter((c) => c.marca === marca)
      .map((c) => c.modelo)
      .filter((v, i, a) => a.indexOf(v) === i)
      // Excluimos modelos ya intentados (status=wrong) con la marca actual:
      // si ya probaste "Ferrari Stradale" y falló, "Stradale" ya no aparece
      // mientras la marca sea Ferrari. Simplifica el siguiente intento y
      // evita que el usuario pierda un turno repitiendo lo mismo.
      .filter((modeloNombre) => !triedWrongModelKeys.has(`${marcaKey}|${modeloNombre.toLowerCase()}`))
      .sort();
  }, [CARS, marca, marcaValidaSeleccionada, triedWrongModelKeys]);

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
      haptic.warning();
      triggerShake();
      return;
    }

    // Bloqueos por intento repetido. El autocompletado ya filtra las opciones,
    // pero si el usuario teclea el nombre completo a mano (o el año coincide
    // con uno ya fallado) lo cortamos aquí con shake.
    if (triedWrongMarcas.has(submittedMarca.toLowerCase())) {
      haptic.warning();
      triggerShake();
      toast.push(t("guess.marcaAlreadyTried"), { type: "error" });
      return;
    }
    const modelKey = `${submittedMarca.toLowerCase()}|${submittedModelo.toLowerCase()}`;
    if (triedWrongModelKeys.has(modelKey)) {
      haptic.warning();
      triggerShake();
      toast.push(t("guess.modelAlreadyTried"), { type: "error" });
      return;
    }
    if (triedWrongYears.has(submittedAnio)) {
      haptic.warning();
      triggerShake();
      toast.push(t("guess.yearAlreadyTried"), { type: "error" });
      return;
    }

    haptic.impactMedium();

    // Enviamos el id del coche elegido en el autocompletado en vez del par
    // marca/modelo en texto: así el servidor valida directamente contra una
    // fila concreta del catálogo y no tiene que confiar en strings cliente.
    // También pasamos marca/modelo string para que useGame pueda pintarlos
    // en la fila pending mientras espera respuesta del servidor.
    const result = await onSubmit({
      guessCarId: guessCar.id,
      anio: submittedAnio,
      marca: submittedMarca,
      modelo: submittedModelo,
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
        ref={shakeBoxRef}
        // Al terminar la animación, retiramos la clase para que el siguiente
        // triggerShake pueda añadirla de nuevo sin que el navegador la
        // considere "ya aplicada" (defensa en profundidad además del
        // force-reflow en triggerShake).
        onAnimationEnd={(e) => {
          if (e.animationName === "shake") {
            e.currentTarget.classList.remove("animate-shake");
          }
        }}
        className="
          flex w-full min-w-0 flex-col gap-y-3
          md:flex-row md:items-start md:gap-x-2
        "
      >
        <label className="flex w-full min-w-0 flex-col gap-1 md:flex-1">
          <span className="px-1 text-[10px] uppercase tracking-widest text-muted">
            {t("guess.labelMarca")}
          </span>
          <Autocomplete
            id="input-marca"
            value={marca}
            onChange={setMarca}
            onSelect={setMarca}
            options={availableMarcas}
            placeholder={t("guess.placeholderMarca")}
            disabled={formDisabled}
            invalid={marcaInvalida}
          />
        </label>

        <label className="flex w-full min-w-0 flex-col gap-1 md:flex-1">
          <span className="px-1 text-[10px] uppercase tracking-widest text-muted">
            {t("guess.labelModelo")}
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
            placeholder={marcaValidaSeleccionada ? "" : t("guess.placeholderModeloDisabled")}
            disabled={formDisabled || !marcaValidaSeleccionada}
            invalid={modeloInvalido}
          />
        </label>

        <label className="flex w-full min-w-0 flex-col gap-1 md:w-24 md:shrink-0">
          <span className="px-1 text-[10px] uppercase tracking-widest text-muted">
            {t("guess.labelAnio")}
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
              // Anti-fricción de teclados móviles y password managers:
              //   - autoComplete="off": iOS a veces ofrece autofill de OTP
              //     en inputs numéricos. Esto lo desactiva.
              //   - enterKeyHint="done": el teclado muestra "OK/Done" en
              //     vez del genérico "↵", coherente con que es el último
              //     campo del formulario antes del submit.
              //   - data-1p-ignore / data-lpignore: 1Password y LastPass
              //     no inyectan su icono sobre el input.
              autoComplete="off"
              enterKeyHint="done"
              data-1p-ignore="true"
              data-lpignore="true"
              value={anio}
              onChange={(e) => setAnio(e.target.value)}
              // Bloqueamos el cambio de año con la rueda del ratón: el
              // navegador solo aplica el wheel-to-increment si el input
              // está focuseado, así que al hacer blur en cuanto entra
              // wheel evitamos el cambio sin bloquear el scroll de la
              // página (no llamamos preventDefault).
              onWheel={(e) => e.currentTarget.blur()}
              disabled={formDisabled}
              placeholder={t("guess.placeholderAnio")}
              min={MIN_YEAR}
              max={CURRENT_YEAR}
              className="
                focus-ring
                h-11 w-full min-w-0 rounded-lg border border-border-strong
                bg-bg-secondary pl-3 pr-7 text-sm text-white
                shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]
                transition-colors focus:border-accent placeholder:text-muted/70
                enabled:hover:border-accent/40
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
            {t("guess.yearsToleranceHelp")}
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
          transition-[background-color,opacity,transform] duration-150
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
            {t("guess.submitting")}
          </span>
        ) : (
          t("guess.submit")
        )}
      </button>
    </form>
  );
}
