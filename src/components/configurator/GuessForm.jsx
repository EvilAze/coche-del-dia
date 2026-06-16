// src/components/configurator/GuessForm.jsx
// Formulario del configurador: Combo marca → Combo modelo → YearField + ADIVINAR.
// Reescritura visual del GuessForm de producción que conserva EXACTA su lógica
// anti-trampa y de validación (marca/modelo/año ya intentados se filtran o se
// rechazan con shake + toast; el modelo se bloquea hasta elegir marca válida;
// el servidor sigue siendo la fuente de verdad y recibe `guessCarId`).

import { useEffect, useMemo, useRef, useState } from "react";
import { useCatalog } from "../../data/catalog";
import { useT } from "../../i18n";
import { useToast } from "../Toast";
import { haptic } from "../../lib/haptics";
import { flagImagePath } from "../../data/countries";
import Combo from "./Combo";
import YearField from "./YearField";

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1886;

export default function GuessForm({ onSubmit, isSubmitting = false, guesses = [], tolerance = 2 }) {
  const { t } = useT();
  const toast = useToast();
  const { data: catalog } = useCatalog();
  const CARS = catalog?.cars ?? [];
  const MARCAS = catalog?.marcas ?? [];

  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [anio, setAnio] = useState("");
  const [shake, setShake] = useState(false);

  // Cadena de foco (QoL móvil) para no abrir/cerrar el teclado 4 veces por
  // intento: elegir marca → enfoca modelo; elegir modelo → enfoca año. El foco
  // se mueve SOLO en selecciones reales del usuario (onCommit del Combo),
  // nunca en resets programáticos post-submit.
  const modeloRef = useRef(null);
  const anioRef = useRef(null);

  // El campo siguiente puede acabar de habilitarse en ESTE mismo render (modelo
  // se activa al elegir una marca válida), así que esperamos al frame siguiente
  // para enfocarlo ya habilitado. Enfocar dentro del gesto de selección hace
  // que el teclado del siguiente campo se abra solo, evitando el baile manual.
  const focusSoon = (ref) => {
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el && !el.disabled) el.focus();
    });
  };

  // ── Conjuntos de "ya intentado sin éxito" (idéntico a GuessForm prod) ──
  const triedWrongMarcas = useMemo(() => {
    const set = new Set();
    for (const g of guesses) {
      const st = g?.marca?.status;
      if ((st === "wrong" || st === "partial") && g.marca?.val) set.add(g.marca.val.toLowerCase());
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
      if (g?.anio?.status === "wrong" && g.anio.val != null) set.add(String(g.anio.val));
    }
    return set;
  }, [guesses]);

  const availableMarcas = useMemo(() => {
    if (triedWrongMarcas.size === 0) return MARCAS;
    const filtered = MARCAS.filter((m) => !triedWrongMarcas.has(m.toLowerCase()));
    return filtered.length > 0 ? filtered : MARCAS;
  }, [MARCAS, triedWrongMarcas]);

  const marcaPais = useMemo(() => {
    const m = {};
    for (const c of CARS) if (c.marca && c.pais && !m[c.marca]) m[c.marca] = c.pais;
    return m;
  }, [CARS]);

  const marcaValida = MARCAS.includes(marca);
  const marcaInvalida = marca.trim().length > 0 && !marcaValida;

  // ANTI-CHEAT: sin marca válida, lista de modelos vacía (+ campo deshabilitado).
  const modelOptions = useMemo(() => {
    if (!marcaValida) return [];
    const key = marca.toLowerCase();
    return CARS.filter((c) => c.marca === marca)
      .map((c) => c.modelo)
      .filter((v, i, a) => a.indexOf(v) === i)
      .filter((m) => !triedWrongModelKeys.has(`${key}|${m.toLowerCase()}`))
      .sort();
  }, [CARS, marca, marcaValida, triedWrongModelKeys]);

  const modeloValido = marcaValida && CARS.some((c) => c.marca === marca && c.modelo === modelo);
  const modeloInvalido = marcaValida && modelo.trim().length > 0 && !modeloValido;

  useEffect(() => {
    if (!modelo || !marcaValida) return;
    if (!CARS.some((c) => c.marca === marca && c.modelo === modelo)) setModelo("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marca]);

  // ── Carry-forward TRAS RECARGA (cierre del punto #1 de la auditoría) ──
  // Los aciertos parciales viven en `guesses` (fuente de verdad del servidor),
  // pero el estado del formulario nace vacío en cada carga: el post-submit de
  // handleSubmit solo conserva los campos correctos DENTRO de la sesión. Los
  // navegadores in-app (Telegram, Google app — el grueso del tráfico móvil)
  // recargan la página con cualquier cambio de app, así que el jugador que
  // volvía a mitad de partida tenía que reescribir marca/modelo ya acertados.
  // Derivamos el valor "resuelto" de cada campo desde el historial y lo
  // aplicamos UNA sola vez por valor (ref): si el usuario borra el campo a
  // propósito después, no se lo rellenamos otra vez en cada render.
  const solved = useMemo(() => {
    const s = { marca: null, modelo: null, anio: null };
    for (const g of guesses) {
      if (g?.marca?.status === "correct" && g.marca.val) s.marca = g.marca.val;
      if (g?.modelo?.status === "correct" && g.modelo.val) s.modelo = g.modelo.val;
      if (g?.anio?.status === "correct" && g.anio.val != null) s.anio = g.anio.val;
    }
    return s;
  }, [guesses]);

  const prefilledRef = useRef({ marca: null, modelo: null, anio: null });
  useEffect(() => {
    if (solved.marca && prefilledRef.current.marca !== solved.marca) {
      prefilledRef.current.marca = solved.marca;
      setMarca(solved.marca);
    }
    if (solved.modelo && prefilledRef.current.modelo !== solved.modelo) {
      prefilledRef.current.modelo = solved.modelo;
      setModelo(solved.modelo);
    }
    if (solved.anio != null && prefilledRef.current.anio !== solved.anio) {
      prefilledRef.current.anio = solved.anio;
      const n = parseInt(solved.anio, 10);
      if (!isNaN(n)) setAnio(n);
    }
  }, [solved]);

  function triggerShake() {
    setShake(false);
    // Force re-trigger en el siguiente frame.
    requestAnimationFrame(() => setShake(true));
  }

  const formDisabled = isSubmitting || !catalog;
  const anioNum = parseInt(anio, 10);
  const anioValido = !isNaN(anioNum) && anioNum >= MIN_YEAR && anioNum <= CURRENT_YEAR;
  const canSubmit = marcaValida && modeloValido && anioValido && !formDisabled;

  async function handleSubmit(e) {
    e.preventDefault();
    if (formDisabled) return;

    if (!marcaValida || !modeloValido || !anioValido) {
      // El botón ya NO se deshabilita por campos incompletos (solo cambia de
      // aspecto): un botón muerto no explica nada. Tocarlo con el intento a
      // medias hace shake + nombra el PRIMER campo que falta — frustración
      // convertida en guía (auditoría UX #5).
      haptic.warning(); triggerShake();
      const missing = !marcaValida
        ? t("guess.missingMarca")
        : !modeloValido
        ? t("guess.missingModelo")
        : t("guess.missingAnio");
      toast.push(missing, { type: "error" });
      return;
    }
    if (triedWrongMarcas.has(marca.toLowerCase())) {
      haptic.warning(); triggerShake();
      toast.push(t("guess.marcaAlreadyTried"), { type: "error" });
      return;
    }
    if (triedWrongModelKeys.has(`${marca.toLowerCase()}|${modelo.toLowerCase()}`)) {
      haptic.warning(); triggerShake();
      toast.push(t("guess.modelAlreadyTried"), { type: "error" });
      return;
    }
    if (triedWrongYears.has(String(anioNum))) {
      haptic.warning(); triggerShake();
      toast.push(t("guess.yearAlreadyTried"), { type: "error" });
      return;
    }

    const guessCar = CARS.find((c) => c.marca === marca && c.modelo === modelo);
    if (!guessCar) return;

    haptic.impactMedium();
    const result = await onSubmit({ guessCarId: guessCar.id, anio: String(anioNum), marca, modelo });
    if (!result) return;

    setMarca(result.marca.status === "correct" ? marca : "");
    setModelo(result.modelo.status === "correct" ? modelo : "");
    setAnio(result.anio.status === "correct" ? anioNum : "");
  }

  return (
    <div
      className={shake ? "animate-shake" : ""}
      onAnimationEnd={() => setShake(false)}
    >
      <form className="flex flex-col gap-3" onSubmit={handleSubmit} autoComplete="off">
        {/* Marca + Modelo lado a lado (calcado del v0); Año y ADIVINAR a ancho completo. */}
        <div className="grid grid-cols-2 gap-2">
        <Combo
          label={t("cdd.labelMarca")}
          value={marca}
          onChange={(v) => { setMarca(v); if (!MARCAS.includes(v)) setModelo(""); }}
          onCommit={() => focusSoon(modeloRef)}
          options={availableMarcas}
          placeholder={t("cdd.comboPlaceholder")}
          disabled={formDisabled}
          invalid={marcaInvalida}
          optionFlag={(m) => (marcaPais[m] ? flagImagePath(marcaPais[m]) : null)}
          enterKeyHint="next"
        />
        <Combo
          label={t("cdd.labelModelo")}
          value={modelo}
          onChange={setModelo}
          onCommit={() => focusSoon(anioRef)}
          inputRef={modeloRef}
          options={modelOptions}
          placeholder={marcaValida ? t("cdd.comboPlaceholder") : t("cdd.comboModeloDisabled")}
          disabled={formDisabled || !marcaValida}
          invalid={modeloInvalido}
          enterKeyHint="next"
        />
        </div>
        <YearField value={anio} onChange={setAnio} tolerance={tolerance} inputRef={anioRef} />
        {/* disabled SOLO mientras envía o sin catálogo (anti doble-submit).
            Con campos incompletos el botón queda tocable con aspecto apagado
            (.is-incomplete): el tap dispara el shake + toast de arriba. La
            transición CSS apagado→accent al completarse el formulario es el
            micro-feedback de "listo para disparar". */}
        <button
          type="submit"
          className={"btn btn--mint h-12 w-full rounded-xl" + (!canSubmit && !formDisabled ? " is-incomplete" : "")}
          disabled={formDisabled}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? t("cdd.submitting") : t("cdd.submit")}
        </button>
      </form>
    </div>
  );
}
