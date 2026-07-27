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
import { resolver } from "../../lib/resolver";
import { yearRange } from "../../lib/yearRange";
import Combo from "./Combo";
import YearField from "./YearField";

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1886;

// Cuánto dura el veredicto de FALLO sobre el campo antes de que se limpie solo.
// Se probaron las dos alternativas: dejarlo fijo hasta que el jugador tocara el
// campo obliga a un gesto extra por intento (y en móvil, a seleccionar y borrar);
// no enseñarlo deja el intento sin acuse de recibo. 1,2s es lo que tarda en
// leerse una palabra tachada — el feedback dura exactamente lo que sirve.
const VEREDICTO_MS = 1200;

export default function GuessForm({ onSubmit, isSubmitting = false, guesses = [], tolerance = 2, attempts, maxAttempts = 5 }) {
  const { t } = useT();
  const toast = useToast();
  const { data: catalog } = useCatalog();
  const CARS = catalog?.cars ?? [];
  const MARCAS = catalog?.marcas ?? [];

  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [anio, setAnio] = useState("");
  const [shake, setShake] = useState(false);

  // ── Veredicto estampado sobre los propios campos ──────────────────────────
  // Sustituye a la fila «último intento», que repetía bajo la foto lo que el
  // jugador acababa de escribir tres renglones más abajo. Shape:
  //   { marca: {val, estado}, modelo: {...}, anio: {...} } | null
  // con estado ∈ "resuelto" | "descartado" | "cerca". Los campos ACERTADOS no
  // dependen de este estado —se derivan de `solved`, que viene del servidor y
  // sobrevive a recargas—; esto es solo para el flash de los fallados.
  const [veredicto, setVeredicto] = useState(null);
  const veredictoTimer = useRef(null);
  useEffect(() => () => clearTimeout(veredictoTimer.current), []);

  // Cualquier intervención del jugador cancela el flash: si ya está tecleando el
  // intento siguiente, el anterior sobra y no debe pisarle el campo.
  function cancelarVeredicto() {
    clearTimeout(veredictoTimer.current);
    setVeredicto(null);
  }

  // Cadena de foco (QoL móvil) para no abrir/cerrar el teclado 4 veces por
  // intento: elegir marca → enfoca modelo; elegir modelo → enfoca año. El foco
  // se mueve SOLO en selecciones reales del usuario (onCommit del Combo),
  // nunca en resets programáticos post-submit.
  const marcaRef = useRef(null);
  const modeloRef = useRef(null);
  const anioRef = useRef(null);
  // Destino del scroll post-envío en móvil (antes era la fila «último intento»,
  // que ya no existe: el veredicto vive en estos campos).
  const cuponRef = useRef(null);

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

  // Campos ya resueltos → BLOQUEADOS el resto de la partida. El formulario
  // encoge de tres renglones a dos a uno según se acierta: el juego se vuelve
  // más fácil de operar según se vuelve más difícil de resolver.
  const bloqueo = {
    marca: Boolean(solved.marca),
    modelo: Boolean(solved.modelo),
    anio: solved.anio != null,
  };

  // ── Pistas que SOBREVIVEN al flash ────────────────────────────────────────
  // El valor tachado es efímero (ya lo has leído y el combo no te deja
  // repetirlo), pero la PISTA que dejó no lo es: se sigue usando en los
  // intentos siguientes, así que se queda pegada al campo hasta que se resuelva.
  //
  // Marca: el «mismo país». Se deriva del historial, no del veredicto en curso,
  // porque su vida útil es toda la partida: si en el intento 1 supiste que el
  // coche es alemán, esa bandera te sirve en el 2, en el 3 y en el 4.
  const paisCerca = useMemo(() => {
    if (solved.marca) return null;
    for (let i = guesses.length - 1; i >= 0; i--) {
      const m = guesses[i]?.marca;
      if (m?.status === "partial" && m.pais) return m.pais;
    }
    return null;
  }, [guesses, solved.marca]);

  // Año: la flecha del último fallo y la horquilla que acumulan todos.
  const ultimaDireccion = useMemo(() => {
    for (let i = guesses.length - 1; i >= 0; i--) {
      const a = guesses[i]?.anio;
      if (a && a.status !== "correct" && a.direction) return a.direction;
    }
    return null;
  }, [guesses]);
  const horquilla = useMemo(
    () => yearRange(guesses, tolerance, CURRENT_YEAR),
    [guesses, tolerance]
  );

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

    // Prefijo inequívoco → canónico ("jag" → Jaguar) ANTES de validar: en
    // móvil teclear el nombre completo es la mayor fricción del cupón. Solo
    // autocompleta con UNA coincidencia; con ambigüedad, la validación de
    // siempre pide elegir. Se refleja en el estado para que el jugador VEA
    // qué se ha enviado.
    // OJO: el borrador tecleado vive en el `q` INTERNO del Combo (el estado
    // marca/modelo solo se llena al confirmar una opción), así que el texto
    // real hay que leerlo del input vía ref cuando el estado está vacío.
    const marcaTexto = marca || marcaRef.current?.value || "";
    const modeloTexto = modelo || modeloRef.current?.value || "";
    const marcaFinal = resolver(marcaTexto, MARCAS);
    const marcaFinalValida = MARCAS.includes(marcaFinal);
    const modeloFinal = marcaFinalValida
      ? resolver(
          modeloTexto,
          CARS.filter((c) => c.marca === marcaFinal).map((c) => c.modelo)
        )
      : modeloTexto;
    const modeloFinalValido =
      marcaFinalValida && CARS.some((c) => c.marca === marcaFinal && c.modelo === modeloFinal);
    if (marcaFinal !== marca) setMarca(marcaFinal);
    if (modeloFinal !== modelo) setModelo(modeloFinal);

    if (!marcaFinalValida || !modeloFinalValido || !anioValido) {
      // El botón ya NO se deshabilita por campos incompletos (solo cambia de
      // aspecto): un botón muerto no explica nada. Tocarlo con el intento a
      // medias hace shake + nombra el PRIMER campo que falta — frustración
      // convertida en guía (auditoría UX #5).
      haptic.warning(); triggerShake();
      const missing = !marcaFinalValida
        ? t("guess.missingMarca")
        : !modeloFinalValido
        ? t("guess.missingModelo")
        : t("guess.missingAnio");
      toast.push(missing, { type: "error" });
      return;
    }
    if (triedWrongMarcas.has(marcaFinal.toLowerCase())) {
      haptic.warning(); triggerShake();
      toast.push(t("guess.marcaAlreadyTried"), { type: "error" });
      return;
    }
    if (triedWrongModelKeys.has(`${marcaFinal.toLowerCase()}|${modeloFinal.toLowerCase()}`)) {
      haptic.warning(); triggerShake();
      toast.push(t("guess.modelAlreadyTried"), { type: "error" });
      return;
    }
    if (triedWrongYears.has(String(anioNum))) {
      haptic.warning(); triggerShake();
      toast.push(t("guess.yearAlreadyTried"), { type: "error" });
      return;
    }

    const guessCar = CARS.find((c) => c.marca === marcaFinal && c.modelo === modeloFinal);
    if (!guessCar) return;

    haptic.impactMedium();
    const result = await onSubmit({ guessCarId: guessCar.id, anio: String(anioNum), marca: marcaFinal, modelo: modeloFinal });
    if (!result) return;

    setMarca(result.marca.status === "correct" ? marcaFinal : "");
    setModelo(result.modelo.status === "correct" ? modeloFinal : "");
    setAnio(result.anio.status === "correct" ? anioNum : "");

    // El veredicto se estampa sobre los campos. Solo necesitamos entrada para
    // los FALLADOS: el campo acertado ya se pinta como resuelto a partir de
    // `solved`, que viene del servidor y no caduca.
    const aEstado = (st) =>
      st === "correct" ? null : st === "partial" ? "cerca" : "descartado";
    setVeredicto({
      marca: { val: marcaFinal, estado: aEstado(result.marca.status) },
      modelo: { val: modeloFinal, estado: aEstado(result.modelo.status) },
      anio: { val: anioNum, estado: aEstado(result.anio.status) },
    });
    clearTimeout(veredictoTimer.current);
    veredictoTimer.current = setTimeout(() => setVeredicto(null), VEREDICTO_MS);

    // QoL móvil (columna única): cerrar el teclado y devolver el cupón entero a
    // la vista. Antes se centraba la fila «último intento»; ahora el veredicto
    // está EN los campos, así que el destino del scroll es el propio cupón.
    if (window.matchMedia("(max-width: 1099px)").matches) {
      document.activeElement?.blur?.();
      requestAnimationFrame(() => {
        cuponRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  }

  return (
    // Cupón de respuesta SIMPLIFICADO: fuera el marco recortable, el título
    // "Cupón de respuesta" y el folio de intento. Queda un formulario limpio de
    // tres renglones apilados (marca → modelo → año) a ancho completo, alineado
    // al mismo borde que la foto. El temblor de errata sigue sacudiendo el
    // bloque al validar en falso.
    <div
      ref={cuponRef}
      className={"prensa-cupon" + (shake ? " animate-temblor" : "")}
      onAnimationEnd={() => setShake(false)}
    >
      {/* El veredicto es visual (color + marca de corrector sobre el campo), así
          que para el lector de pantalla lo dictamos aquí. Sustituye al
          aria-live que tenía la fila «último intento». */}
      <p className="sr-only" role="status" aria-live="polite">
        {veredicto
          ? [
              `${t("cdd.labelMarca")}: ${veredicto.marca.val} — ${
                veredicto.marca.estado === null
                  ? t("cdd.srCorrect")
                  : veredicto.marca.estado === "cerca"
                  ? t("cdd.sameCountry")
                  : t("cdd.srWrong")
              }`,
              `${t("cdd.labelModelo")}: ${veredicto.modelo.val} — ${
                veredicto.modelo.estado === null ? t("cdd.srCorrect") : t("cdd.srWrong")
              }`,
              `${t("cdd.labelAnio")}: ${veredicto.anio.val} — ${
                veredicto.anio.estado === null
                  ? t("cdd.srCorrect")
                  : ultimaDireccion
                  ? t(ultimaDireccion === "up" ? "cdd.yearNewer" : "cdd.yearOlder")
                  : t("cdd.srWrong")
              }`,
            ].join(". ")
          : ""}
      </p>

      <form className="flex flex-col gap-3" onSubmit={handleSubmit} autoComplete="off">
        {/* Tres renglones apilados a ancho completo: marca, modelo y año. Cada
            campo ocupa toda la fila (target grande, nombres largos legibles) en
            vez del par marca|modelo comprimido de antes. Cada uno lleva ahora su
            propio veredicto: el resuelto se queda con ✓ y bloqueado, el fallado
            se tacha 1,2s y se limpia. */}
        <Combo
          label={t("cdd.labelMarca")}
          value={marca}
          onChange={(v) => { cancelarVeredicto(); setMarca(v); if (!MARCAS.includes(v)) setModelo(""); }}
          onCommit={() => focusSoon(modeloRef)}
          inputRef={marcaRef}
          options={availableMarcas}
          placeholder={t("cdd.comboPlaceholder")}
          disabled={formDisabled}
          invalid={marcaInvalida}
          optionFlag={(m) => (marcaPais[m] ? flagImagePath(marcaPais[m]) : null)}
          enterKeyHint="next"
          bloqueado={bloqueo.marca}
          estado={bloqueo.marca ? "resuelto" : veredicto?.marca.estado ?? null}
          valorVeredicto={!bloqueo.marca && veredicto ? veredicto.marca.val : null}
          apostilla={
            paisCerca ? (
              <span className="prensa-campo-marca cerca">
                <img className="bandera" src={flagImagePath(paisCerca)} alt="" draggable={false} />
                {t("cdd.sameCountry")}
              </span>
            ) : null
          }
        />
        <Combo
          label={t("cdd.labelModelo")}
          value={modelo}
          onChange={(v) => { cancelarVeredicto(); setModelo(v); }}
          onCommit={() => focusSoon(anioRef)}
          inputRef={modeloRef}
          options={modelOptions}
          placeholder={marcaValida ? t("cdd.comboPlaceholder") : t("cdd.comboModeloDisabled")}
          disabled={formDisabled || !marcaValida}
          invalid={modeloInvalido}
          enterKeyHint="next"
          bloqueado={bloqueo.modelo}
          estado={bloqueo.modelo ? "resuelto" : veredicto?.modelo.estado ?? null}
          valorVeredicto={!bloqueo.modelo && veredicto ? veredicto.modelo.val : null}
        />
        <YearField
          value={anio}
          onChange={(v) => { cancelarVeredicto(); setAnio(v); }}
          tolerance={tolerance}
          inputRef={anioRef}
          bloqueado={bloqueo.anio}
          estado={bloqueo.anio ? "resuelto" : veredicto?.anio.estado ?? null}
          valorVeredicto={!bloqueo.anio && veredicto ? String(veredicto.anio.val) : null}
          direccion={ultimaDireccion}
          horquilla={horquilla}
        />
        {/* disabled SOLO mientras envía o sin catálogo (anti doble-submit).
            Con campos incompletos el botón queda tocable con aspecto apagado
            (.is-incomplete): el tap dispara el shake + toast de arriba. La
            transición CSS apagado→accent al completarse el formulario es el
            micro-feedback de "listo para disparar". */}
        <button
          type="submit"
          className={"prensa-submit mt-1.5" + (!canSubmit && !formDisabled ? " is-incomplete" : "")}
          disabled={formDisabled}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? t("cdd.submitting") : t("cdd.submit")}
        </button>
      </form>
    </div>
  );
}
