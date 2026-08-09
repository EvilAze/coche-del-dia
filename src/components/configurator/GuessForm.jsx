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
import { esApp } from "../../lib/plataforma";
import { useHistoryClose } from "../../hooks/useHistoryClose";
import Combo from "./Combo";
import YearField from "./YearField";
import CampoBoton from "./CampoBoton";
import SelectorHoja from "./SelectorHoja";
import SelectorLista from "./SelectorLista";
import SelectorAnio, { textoHorquilla } from "./SelectorAnio";

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1886;

// (Aquí vivía VEREDICTO_MS, el tiempo que el valor fallado se quedaba tachado
// sobre el campo. El flash se retiró al simplificar el cupón: el acuse de recibo
// lo da ahora el historial, que desde entonces también se pinta en móvil.)

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

  // ── DOS FORMAS DE RELLENAR EL CUPÓN, UNA POR PLATAFORMA ────────────────────
  // En WEB se teclea, como siempre: hay teclado físico o el móvil está en un
  // navegador donde la página scrollea y el desplegable es lo natural. Esa rama
  // no se toca en este cambio, ni una línea.
  //
  // En la APP los tres renglones son botones que abren una hoja de selección
  // (ver SelectorHoja). Motivo: el teclado del sistema se comía media pantalla,
  // tapaba la fotografía —que es el juego— y obligaba a inventar un modo de
  // maqueta entero para sobrevivirle. Y no había nada que teclear: el catálogo
  // es cerrado, así que esto no es un buscador, es una elección.
  //
  // `hoja` es cuál está abierta, o null. Una sola variable en vez de tres
  // booleanos: así es imposible que dos hojas se abran a la vez.
  const enApp = esApp();
  const [hoja, setHoja] = useState(null);
  const cerrarHoja = () => setHoja(null);

  // El último paso que se enseñó. La hoja tarda en irse (ModalShell deja correr
  // su animación de salida), así que si el contenido colgara de `hoja` a secas
  // se vaciaría en el mismo frame del cierre y se vería colapsar por dentro.
  const ultimoPaso = useRef("marca");
  if (hoja) ultimoPaso.current = hoja;
  const paso = hoja ?? ultimoPaso.current;

  // El «atrás» de Android CIERRA la hoja, no se lleva al jugador fuera de la
  // partida. Es de las cosas que más delatan a una web disfrazada de app: en
  // Android, atrás es el gesto de «deshaz lo último», y lo último ha sido abrir
  // una lista.
  //
  // Va aquí y no en el slot `activeModal` de App.jsx a propósito: esa capa no
  // sabe de estas hojas, y meter dos capas a empujar entradas de historial por
  // la misma pulsación es exactamente el enredo que documenta ModalShell (una
  // entrada huérfana y la siguiente pulsación de atrás que no hace nada). Una
  // sola capa por overlay, y esta es la suya. En web `hoja` es siempre null,
  // así que el hook queda inerte.
  useHistoryClose(hoja !== null, cerrarHoja);

  // Cadena de foco (QoL móvil) para no abrir/cerrar el teclado 4 veces por
  // intento: elegir marca → enfoca modelo; elegir modelo → enfoca año. El foco
  // se mueve SOLO en selecciones reales del usuario (onCommit del Combo),
  // nunca en resets programáticos post-submit.
  const marcaRef = useRef(null);
  const modeloRef = useRef(null);
  const anioRef = useRef(null);
  // Destino del scroll post-envío en móvil: el cupón entero (antes era la fila
  // «último intento», que ya no existe).
  const cuponRef = useRef(null);

  // (Aquí vivió un ResizeObserver que publicaba el alto del cupón en
  // `--cdd-cupon-alto`. Lo necesitaba la primera versión del modo escritura,
  // que anclaba el cupón abajo y abría el desplegable hacia arriba: había que
  // saber cuánto medía el cupón para que la lista no se saliera por el techo.
  // Con la lista cayendo hacia el teclado, el techo es el borde de la ventana y
  // el CSS lo sabe solo — así que sobra medir nada.)

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

  // Año: la horquilla que acumulan todos los intentos previos.
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
    // Año FUERA de la horquilla ya deducida. Sin esta comprobación el juego
    // aceptaba un intento que él mismo sabía imposible —las flechas ↑/↓ previas
    // ya lo habían descartado, y encima se lo estábamos enseñando al jugador
    // bajo el campo— y le gastaba uno de sus cinco intentos en él. En una
    // partida de cinco, regalar uno por descuido es la fricción más cara que
    // hay. Mismo trato que el año repetido: temblor + aviso, no bloqueo del
    // botón (un botón muerto no explica nada).
    if (horquilla.acotada && (anioNum < horquilla.min - tolerance || anioNum > horquilla.max + tolerance)) {
      haptic.warning(); triggerShake();
      toast.push(t("guess.yearOutOfRange"), { type: "error" });
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

    // QoL móvil (columna única): cerrar el teclado y devolver el cupón entero a
    // la vista. Antes se centraba la fila «último intento»; sin ella el destino
    // del scroll es el propio cupón.
    if (window.matchMedia("(max-width: 1099px)").matches) {
      document.activeElement?.blur?.();
      requestAnimationFrame(() => {
        cuponRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  }

  // ── LA CADENA DE LA HOJA (app) ─────────────────────────────────────────────
  // Elegir un valor NO cierra la hoja: la lleva al siguiente campo que esté
  // vacío. Un solo gesto rellena marca → modelo → año, y entre pasos el teclado
  // no baja y vuelve a subir, que es lo que se sentía torpe.
  //
  // Solo hacia campos VACÍOS, y esto es lo que lo salva de ser un asistente
  // pesado: si abres MARCA para corregirla y el resto ya está puesto, la hoja
  // se cierra al elegir y te devuelve al cupón. Es la misma regla que la cadena
  // de foco de la web, que solo avanza en selecciones reales del usuario.
  function siguientePaso(modeloAhora, anioAhora) {
    if (!modeloAhora && !bloqueo.modelo) return "modelo";
    if (!anioAhora && !bloqueo.anio) return "anio";
    return null;
  }

  function elegirMarca(v) {
    // Cambiar de marca invalida el modelo elegido: es de otra casa. Se calcula
    // el valor RESULTANTE en vez de leer el estado, que en este mismo tick
    // todavía tiene el anterior.
    const modeloTrasCambio = v === marca ? modelo : "";
    if (v !== marca) setModelo("");
    setMarca(v);
    setHoja(siguientePaso(modeloTrasCambio, anio));
  }

  function elegirModelo(v) {
    setModelo(v);
    setHoja(siguientePaso(v, anio));
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


      {/* Sin clases de marco aquí: el cupón lo dibuja (o no) `.prensa-cupon` del
          div de arriba. Hubo un intento de enmarcarlo con utilidades de Tailwind
          —borde discontinuo, padding, fondo— que NUNCA llegó a verse: en
          index.css las reglas propias van después de `@tailwind utilities`, así
          que `.prensa-cupon { border:0; padding:0; background:transparent }` las
          pisaba a igual especificidad. Si algún día vuelve el marco, va al CSS. */}
      <form className="flex flex-col gap-3" onSubmit={handleSubmit} autoComplete="off">
        {/* Tres renglones apilados a ancho completo: marca, modelo y año. Cada
            campo ocupa toda la fila (target grande, nombres largos legibles) en
            vez del par marca|modelo comprimido de antes. El campo ACERTADO se
            queda con ✓ y bloqueado; el fallado se limpia y su marca sale del
            combo, así que no hace falta tacharlo. */}
        {enApp ? (
          <>
            <CampoBoton
              label={t("cdd.labelMarca")}
              valor={marca}
              placeholder={t("cdd.selectorPick")}
              onClick={() => setHoja("marca")}
              disabled={formDisabled}
              resuelto={bloqueo.marca}
            />
            <CampoBoton
              label={t("cdd.labelModelo")}
              valor={modelo}
              // Sin marca no hay lista que abrir (anti-cheat: los modelos
              // acotan el coche). El renglón lo dice en vez de quedarse mudo.
              placeholder={marcaValida ? t("cdd.selectorPick") : t("cdd.comboModeloDisabled")}
              onClick={() => setHoja("modelo")}
              disabled={formDisabled || !marcaValida}
              resuelto={bloqueo.modelo}
            />
            <CampoBoton
              label={t("cdd.labelAnio")}
              valor={anio ? String(anio) : ""}
              placeholder={t("cdd.selectorPick")}
              onClick={() => setHoja("anio")}
              disabled={formDisabled}
              resuelto={bloqueo.anio}
              // La horquilla sigue a la vista sin abrir nada: es la pista que
              // dice por dónde va la búsqueda del año.
              apunte={bloqueo.anio ? null : textoHorquilla(t, horquilla, tolerance)}
            />
          </>
        ) : (
        <>
        <Combo
          label={t("cdd.labelMarca")}
          value={marca}
          onChange={(v) => { setMarca(v); if (!MARCAS.includes(v)) setModelo(""); }}
          onCommit={() => focusSoon(modeloRef)}
          inputRef={marcaRef}
          options={availableMarcas}
          placeholder={t("cdd.comboPlaceholder")}
          disabled={formDisabled}
          invalid={marcaInvalida}
          optionFlag={(m) => (marcaPais[m] ? flagImagePath(marcaPais[m]) : null)}
          enterKeyHint="next"
          bloqueado={bloqueo.marca}
          estado={bloqueo.marca ? "resuelto" : null}
        />
        <Combo
          label={t("cdd.labelModelo")}
          value={modelo}
          onChange={(v) => setModelo(v)}
          onCommit={() => focusSoon(anioRef)}
          inputRef={modeloRef}
          options={modelOptions}
          placeholder={marcaValida ? t("cdd.comboPlaceholder") : t("cdd.comboModeloDisabled")}
          disabled={formDisabled || !marcaValida}
          invalid={modeloInvalido}
          enterKeyHint="next"
          bloqueado={bloqueo.modelo}
          estado={bloqueo.modelo ? "resuelto" : null}
        />
        <YearField
          value={anio}
          onChange={(v) => setAnio(v)}
          tolerance={tolerance}
          inputRef={anioRef}
          bloqueado={bloqueo.anio}
          estado={bloqueo.anio ? "resuelto" : null}
          horquilla={horquilla}
        />
        </>
        )}
        {/* disabled SOLO mientras envía o sin catálogo (anti doble-submit).
            Con campos incompletos el botón queda tocable con aspecto apagado
            (.is-incomplete): el tap dispara el shake + toast de arriba. El
            micro-feedback de "listo para disparar" lo da la transición CSS
            tinta→rojo al completarse los tres campos; el halo que se probó aquí
            no pinta sobre papel (regla 16) y encima lo tumbaba `test:estetica`. */}
        <button
          type="submit"
          className={"prensa-submit mt-2" + (!canSubmit && !formDisabled ? " is-incomplete" : "")}
          disabled={formDisabled}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? t("cdd.submitting") : t("cdd.submit")}
        </button>
      </form>

      {/* LA HOJA, y es UNA SOLA para los tres pasos. Va fuera del <form>:
          dentro sería un diálogo anidado en un formulario, y cualquier despiste
          con el `type` de un botón acabaría enviando el intento desde dentro de
          una lista.
          El contenido se pinta por `paso` y no por `hoja` para que, al cerrar,
          la hoja conserve lo que enseñaba mientras dura su animación de salida:
          con `hoja` a secas se vaciaría de golpe y se vería colapsar. */}
      {enApp && (
        <SelectorHoja
          open={hoja !== null}
          onClose={cerrarHoja}
          titulo={t(`cdd.label${paso === "anio" ? "Anio" : paso === "modelo" ? "Modelo" : "Marca"}`)}
          apunte={
            paso === "anio" ? textoHorquilla(t, horquilla, tolerance)
            : paso === "modelo" ? marca
            : null
          }
        >
          {paso === "marca" && (
            <SelectorLista
              key="marca"
              titulo={t("cdd.labelMarca")}
              opciones={availableMarcas}
              valor={marca}
              optionFlag={(m) => (marcaPais[m] ? flagImagePath(marcaPais[m]) : null)}
              onElegir={elegirMarca}
            />
          )}
          {paso === "modelo" && (
            <SelectorLista
              key="modelo"
              titulo={t("cdd.labelModelo")}
              opciones={modelOptions}
              valor={modelo}
              onElegir={elegirModelo}
            />
          )}
          {paso === "anio" && (
            <SelectorAnio
              key="anio"
              valor={anio}
              horquilla={horquilla}
              tolerance={tolerance}
              onElegir={(v) => { setAnio(v); cerrarHoja(); }}
            />
          )}
        </SelectorHoja>
      )}
    </div>
  );
}
