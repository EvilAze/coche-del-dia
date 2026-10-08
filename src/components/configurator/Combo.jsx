// src/components/configurator/Combo.jsx
// Combobox del configurador (marca / modelo). Port del Combo del prototipo, con
// las mejoras de UX del Autocomplete de producción: filtrado sin acentos,
// navegación por teclado, banderas opcionales por opción, scroll táctil del
// desplegable y auto-scroll del input en móvil (que no quede tras el teclado).

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { haptic } from "../../lib/haptics";
import { acercarCampoAlTeclado } from "../../lib/teclado";
import { normalizar } from "../../lib/texto";
import { useT } from "../../i18n";

// La normalización vive en lib/texto: la comparten este combo (web) y la hoja
// de selección (app), y dos copias acabarían divergiendo en el caso raro — la
// marca con diéresis que se escribe sin ella.
const norm = normalizar;

export default function Combo({
  label,
  hint,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  invalid = false,
  optionFlag = null,
  // Cadena de foco (marca→modelo→año): el padre nos pasa un ref para poder
  // enfocar este input programáticamente, y un onCommit que disparamos al
  // elegir una opción REAL (no al teclear) para que avance al siguiente campo.
  // enterKeyHint deja que el teclado móvil muestre "siguiente" en marca/modelo
  // en vez de la lupa.
  inputRef = null,
  onCommit = null,
  enterKeyHint = "search",
  // ── VEREDICTO EN EL PROPIO CAMPO ──────────────────────────────────────────
  // El resultado del intento dejó de vivir en una fila aparte («último intento»)
  // y se estampa aquí, sobre el renglón donde se escribió. Tres estados:
  //   · "resuelto"   → acertado. Valor + ✓ y campo BLOQUEADO: no se vuelve a
  //                    teclear en toda la partida. El formulario encoge de 3
  //                    campos a 2 a 1 según aciertas.
  //
  // Hubo dos estados más ("descartado" y "cerca") con su capa de veredicto
  // encima del input —el valor tachado a pluma y la bandera del «mismo país»—.
  // Se retiraron al simplificar el cupón: ese acuse de recibo vive ahora en el
  // historial, que por eso volvió a pintarse también en móvil.
  estado = null,
  bloqueado = false,
  // id del aviso del cupón cuando el problema es de este campo (aria-describedby).
  describedBy = undefined,
  // ¿Enfocar el campo despliega la lista? Sí, salvo cuando el foco lo pone el
  // aviso del cupón: la lista cuelga justo encima de la línea del aviso y la
  // tapaba en el mismo frame en que se escribía (visto en producción el 7-oct).
  // Teclear, la flecha abajo o un toque siguen abriéndola.
  abrirAlEnfocar = true,
  // Lo ya probado en esta partida, que `options` ya no incluye. Solo se usa
  // para explicar una búsqueda vacía: al teclear «Ferr» tras haber probado
  // Ferrari, la lista decía «Sin coincidencias», como si la marca no existiera
  // (auditoría 7-oct). Ahora dice «Ferrari · ya lo probaste».
  probadas = [],
  // Las que suben a un grupo propio arriba de la lista, con su título: las
  // marcas del país que el jugador ya sabe por un «mismo país» (ver GuessForm).
  // Salen de su sitio alfabético, no se duplican.
  destacadas = [],
  destacadasTitulo = null,
}) {
  const { t } = useT();
  // id estable para asociar <label> ↔ <input> (a11y: el lector de pantalla
  // anuncia "Marca"/"Modelo" y tocar la etiqueta enfoca el campo).
  const inputId = useId();
  // id de la lista y prefijo de las opciones, para el patrón combobox (abajo).
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef(null);
  const innerRef = useRef(null);
  const listRef = useRef(null);

  // Ref combinado: mantenemos el ref interno (lo usamos para el auto-scroll en
  // móvil) y, si el padre pasó inputRef, lo sincronizamos para que pueda
  // enfocar el input desde la cadena de foco.
  const setInputRef = (node) => {
    innerRef.current = node;
    if (typeof inputRef === "function") inputRef(node);
    else if (inputRef) inputRef.current = node;
  };

  // Texto visible: el valor elegido, o lo que el usuario está tecleando.
  const text = value || q;
  // Sin recorte: hay más de 80 marcas, así que un `.slice(0, 80)` cortaba la
  // lista alfabética por la "R" y ocultaba todo lo posterior (Seat, Tesla,
  // Volkswagen…). La lista es acotada (marcas/modelos) y el desplegable ya
  // hace scroll, así que renderizamos todas las coincidencias (como el
  // Autocomplete de producción).
  // Las coincidencias EN EL ORDEN EN QUE SE VEN: primero las destacadas,
  // después el resto. Las flechas y el Intro recorren este mismo array, así que
  // el orden del teclado y el de la pantalla son el mismo por construcción.
  const { filtered, nArriba } = useMemo(() => {
    const needle = norm(value ? "" : q);
    const coinciden = options.filter((o) => norm(o).includes(needle));
    if (!destacadas.length) return { filtered: coinciden, nArriba: 0 };
    const set = new Set(destacadas);
    const arriba = coinciden.filter((o) => set.has(o));
    // Si TODO es del mismo país (o nada lo es), no hay grupo que separar.
    if (!arriba.length || arriba.length === coinciden.length) return { filtered: coinciden, nArriba: 0 };
    return { filtered: [...arriba, ...coinciden.filter((o) => !set.has(o))], nArriba: arriba.length };
  }, [q, value, options, destacadas]);

  const probadasQueCoinciden = useMemo(() => {
    const needle = norm(value ? "" : q);
    if (!needle || filtered.length > 0) return [];
    return probadas.filter((o) => norm(o).includes(needle));
  }, [q, value, probadas, filtered.length]);

  useEffect(() => { setHi(0); }, [q, value, open]);

  // Si el padre confirma un valor (selección o canonización del resolver en
  // el submit), el borrador tecleado deja de tener sentido: limpiarlo evita
  // que reaparezca al borrar el valor después.
  useEffect(() => { if (value) setQ(""); }, [value]);

  useEffect(() => {
    if (!open) return;
    // Por id y no por posición entre los hijos: con el grupo del mismo país
    // (y las filas de «ya lo probaste») la opción n ya no es el hijo n.
    const el = document.getElementById(`${listId}-op-${hi}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [hi, open, listId]);

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, []);

  function choose(o) {
    haptic.selection();
    onChange(o);
    setQ("");
    setOpen(false);
    // Avanza la cadena de foco al siguiente campo (lo gestiona el padre, que
    // sabe cuál es y espera al frame siguiente por si acaba de habilitarse).
    onCommit?.();
  }

  function onFocus() {
    // Campo resuelto: ni desplegable ni auto-scroll. Es un dato ya cerrado, no
    // un renglón por rellenar — abrirle la lista invitaría a cambiar algo que
    // no se puede cambiar. (`resuelto` se declara abajo; para cuando el usuario
    // puede enfocar, el render ya lo ha inicializado.)
    if (disabled || resuelto) return;
    if (abrirAlEnfocar) setOpen(true);
    // Subir el campo sobre el teclado es cosa de la WEB. En la app lo resuelve
    // la composición (el cupón ya nace pegado al teclado), y desplazar aquí
    // movería un shell que por diseño no se mueve. La decisión vive en
    // lib/teclado.js para que haya un solo sitio que sepa de teclados.
    acercarCampoAlTeclado(innerRef.current);
  }

  function onKey(e) {
    if (resuelto) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      // INTRO ELIGE Y AVANZA, también con la lista cerrada si solo hay una
      // coincidencia. En producción, una vez de tres, «Niss» + Intro dejaba
      // «Nissan» en la marca sin saltar a Modelo y lo siguiente se escribía en
      // la marca («Nissan300», auditoría 7-oct P24): con la lista cerrada (o con
      // `hi` aún apuntando más allá de una lista recién filtrada, porque se
      // reinicia en un efecto) el Intro caía al envío del formulario, que
      // canonizaba la marca pero no movía el foco. Ahora la señalada se acota a
      // la lista y, cerrada, solo se elige lo inequívoco — el mismo criterio que
      // el resolver del envío.
      const senalada = open ? filtered[Math.min(hi, filtered.length - 1)] : null;
      const unica = !open && !value && q.trim() && filtered.length === 1 ? filtered[0] : null;
      const eleccion = senalada || unica;
      if (eleccion) { e.preventDefault(); choose(eleccion); }
    }
    else if (e.key === "Escape") setOpen(false);
  }

  // Piel «Prensa del motor»: label en versalitas + input de LÍNEA BASE (el
  // renglón de un formulario impreso; lo escrito sale "a máquina" en Courier)
  // + listbox de papel con filete. La lógica (autocomplete, anti-cheat,
  // banderas, teclado) es la misma; solo cambia la piel.
  // El campo resuelto sale del flujo de edición por completo: readOnly (no
  // `disabled`, que lo sacaría del árbol accesible y del tab-order sin decir por
  // qué) y sin desplegable. El lector de pantalla anuncia el valor y su estado.
  const resuelto = estado === "resuelto" || bloqueado;

  // PATRÓN COMBOBOX (ARIA 1.2). El teclado ya funcionaba —flechas, Intro,
  // Escape—, pero para un lector de pantalla esto era un campo de búsqueda sin
  // más: no sabía que se había abierto una lista ni cuál estaba resaltada, y la
  // opción resaltada seguía con aria-selected=false. El foco NO sale del input
  // (sigues escribiendo); la opción activa se anuncia con aria-activedescendant
  // y es la que lleva aria-selected.
  const listaVisible = open && !disabled && !resuelto;
  const opcionId = (i) => `${listId}-op-${i}`;
  const activa = listaVisible && filtered[hi] ? opcionId(hi) : undefined;

  const opcionLi = (o, i) => {
    const flag = optionFlag ? optionFlag(o) : null;
    return (
      <li
        key={o}
        id={opcionId(i)}
        role="option"
        aria-selected={i === hi}
        className={"prensa-opt" + (i === hi ? " hi" : "")}
        onMouseEnter={() => setHi(i)}
        onClick={() => choose(o)}
      >
        <span>{o}</span>
        {flag && <img className="bandera" src={flag} alt="" draggable={false} loading="lazy" />}
      </li>
    );
  };

  return (
    <div className="relative flex flex-col gap-0.5" ref={ref}>
      <label htmlFor={inputId} className="prensa-label">
        {label}
        {resuelto && <span className="pista-label resuelta">{t("cdd.fieldSolved")}</span>}
      </label>
      <div className="prensa-campo">
        <input
          id={inputId}
          ref={setInputRef}
          className={
            "prensa-input" +
            (invalid && !open ? " invalida" : "") +
            (resuelto ? " veredicto-resuelto" : "")
          }
          type="search"
          enterKeyHint={enterKeyHint}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          value={text}
          disabled={disabled}
          readOnly={resuelto}
          aria-readonly={resuelto || undefined}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={listaVisible}
          aria-controls={listaVisible ? listId : undefined}
          aria-activedescendant={activa}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          placeholder={placeholder}
          onChange={(e) => { onChange(""); setQ(e.target.value); setOpen(true); }}
          onFocus={onFocus}
          // Un toque sobre el campo ya enfocado también la abre: sin esto, tras
          // cerrarla con Escape (o tras el foco del aviso) solo se reabría
          // tecleando o con la flecha.
          onClick={() => { if (!disabled && !resuelto) setOpen(true); }}
          onKeyDown={onKey}
        />
        {/* El ✓ del campo resuelto vive FUERA del input (un <input> no admite
            hijos) pero dentro de su renglón, a la derecha y sin capturar el
            toque: el objetivo táctil sigue siendo el campo entero. */}
        {resuelto && (
          <span className="prensa-campo-marca bien" aria-hidden="true">✓</span>
        )}
      </div>
      {listaVisible && (
        <ul id={listId} className="prensa-listbox" role="listbox" aria-label={label} ref={listRef}>
          {filtered.length === 0 && probadasQueCoinciden.length === 0 && (
            <li className="prensa-opt vacia" role="option" aria-disabled="true" aria-selected="false">
              {t("cdd.noMatches")}
            </li>
          )}
          {probadasQueCoinciden.map((o) => (
            <li key={`probada-${o}`} className="prensa-opt vacia" role="option" aria-disabled="true" aria-selected="false">
              {t("cdd.yaProbada", { valor: o })}
            </li>
          ))}
          {nArriba > 0 ? (
            <>
              {/* Dos grupos con nombre (role="group"), como las letras de la
                  hoja de la app: el lector de pantalla anuncia «Mismo país que
                  Nissan» al entrar en el primero. */}
              <li role="presentation">
                <p className="prensa-opt-grupo" id={`${listId}-g1`}>{destacadasTitulo}</p>
                <ul role="group" aria-labelledby={`${listId}-g1`}>
                  {filtered.slice(0, nArriba).map((o, i) => opcionLi(o, i))}
                </ul>
              </li>
              <li role="presentation" className="prensa-opt-resto">
                <ul role="group" aria-label={label}>
                  {filtered.slice(nArriba).map((o, i) => opcionLi(o, i + nArriba))}
                </ul>
              </li>
            </>
          ) : (
            filtered.map((o, i) => opcionLi(o, i))
          )}
        </ul>
      )}
    </div>
  );
}
