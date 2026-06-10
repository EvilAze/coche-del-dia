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

  // Cadena de foco (QoL móvil): elegir marca → foco al modelo (su desplegable
  // se abre solo vía onFocus); elegir modelo → foco al año (teclado numérico).
  // Sin esto, cada paso obligaba a cerrar el teclado y tocar el campo
  // siguiente: 4 aperturas/cierres de teclado por intento. El foco se mueve
  // SOLO en selecciones reales del usuario (onPick), nunca en resets
  // programáticos post-submit. rAF: espera al re-render que habilita el campo
  // destino (modelo está disabled hasta que marca es válida).
  const modeloInputRef = useRef(null);
  const anioInputRef = useRef(null);
  const focusNext = (ref) => {
    requestAnimationFrame(() => ref.current?.focus());
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
      haptic.warning(); triggerShake();
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
      className={shake ? "cdd-shakewrap shake" : "cdd-shakewrap"}
      onAnimationEnd={() => setShake(false)}
    >
      <form className="cdd-form" onSubmit={handleSubmit} autoComplete="off">
        <Combo
          label={t("cdd.labelMarca")}
          value={marca}
          onChange={(v) => { setMarca(v); if (!MARCAS.includes(v)) setModelo(""); }}
          onPick={() => focusNext(modeloInputRef)}
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
          onPick={() => focusNext(anioInputRef)}
          inputRef={modeloInputRef}
          options={modelOptions}
          placeholder={marcaValida ? t("cdd.comboPlaceholder") : t("cdd.comboModeloDisabled")}
          disabled={formDisabled || !marcaValida}
          invalid={modeloInvalido}
          enterKeyHint="next"
        />
        <YearField value={anio} onChange={setAnio} tolerance={tolerance} inputRef={anioInputRef} />
        <button type="submit" className="cdd-submit" disabled={!canSubmit} aria-busy={isSubmitting}>
          <span>{isSubmitting ? t("cdd.submitting") : t("cdd.submit")}</span>
        </button>
      </form>
    </div>
  );
}
