// src/components/configurator/SelectorLista.jsx
// El selector de MARCA y de MODELO en la app: la lista dentro de la hoja.
//
// DOS FORMAS SEGÚN EL TAMAÑO, y no es capricho:
//   · Pocas opciones (los modelos de una marca, casi siempre menos de 25):
//     lista corriente. Cabe de un vistazo y cualquier adorno sobra.
//   · Muchas (las ~80 marcas): lista agrupada por inicial con un ÍNDICE A-Z al
//     margen. Sin él, elegir "Volkswagen" es arrastrar el dedo por tres
//     pantallas de lista; con él son dos toques. Es el índice de la agenda del
//     teléfono, que es donde todo el mundo lo ha aprendido.
//
// LA HOJA ABRE EN MODO LISTA, NUNCA EN MODO TECLADO. El buscador está —arriba,
// visible, a un toque— pero NO se enfoca solo.
//
// Aquí vivió lo contrario, y con cuatro párrafos defendiéndolo: por encima de 12
// opciones el campo se enfocaba al abrir, razonando que «dentro de la hoja el
// teclado no cuesta nada». Esa premisa dejó de ser cierta el día que la hoja se
// recortó para no tapar la fotografía (regla 18f). Hoy cuesta, y se puede medir:
//
//   · El cromo de la hoja son 117px antes de la primera fila (tirador 11,
//     cabecera ~49, buscador ~57), y una fila son 52.
//   · Con el teclado arriba en un 360x780 la hoja se queda en 300px, o sea 183
//     de lista: TRES FILAS Y MEDIA. Sobre ochenta marcas.
//   · Y la fotografía baja de 336x252 a 232x174, porque al encoger la ventana el
//     pliego entero se recompone (ver useEscenarioApartado).
//
// El índice A-Z existe precisamente para hacer navegable esa lista de ochenta, y
// con tres filas y media a la vista no sirve de nada: apuntar a una letra de
// 10px para ver tres marcas es peor que arrastrar. El teclado y el índice
// compiten por el mismo hueco y el teclado gana siempre, así que la hoja abre en
// el modo que NO se lo come.
//
// DE AHÍ SALE LA REGLA DE UNA FRASE: la tira A-Z vive mientras no haya teclado.
//
//   Sin foco, sin texto → lista agrupada por inicial + índice A-Z
//   Con foco, sin texto → lista agrupada, sin índice
//   Con texto          → lista plana filtrada, sin índice
//
// Y el foco es la señal, no `visualViewport`: en la app no hay teclado físico,
// así que campo enfocado ≡ teclado arriba, sin medir nada. Bajar el teclado sin
// elegir tampoco necesita nada nuestro — el IME de Android se come el «atrás»
// mientras está subido, así que atrás baja el teclado y el siguiente atrás
// cierra la hoja (useHistoryClose, en GuessForm).
//
// Lo que NO cambia: teclear sigue siendo un camino completo (flechas + Enter,
// ver `alTeclear`). Se deja de imponer, no se retira.
//
// Filtrado sin tildes ni mayúsculas (lib/texto), el mismo criterio que el combo
// de la web: "citroen" tiene que encontrar "Citroën".

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { haptic } from "../../lib/haptics";
import { normalizar } from "../../lib/texto";
import { useT } from "../../i18n";

// A partir de aquí la lista deja de leerse de un vistazo y entra el índice.
// Medido a ojo sobre una pantalla de móvil: ~10 opciones visibles, así que 25
// son dos pantallas y media — el punto donde uno empieza a arrastrar sin saber
// cuánto queda.
const UMBRAL_INDICE = 25;

// (Aquí vivía UMBRAL_AUTOFOCO = 12, el número de opciones a partir del cual el
// buscador se enfocaba solo. Se fue entero con el autofoco: ver la cabecera.)

// Es el CONTENIDO de la hoja, no la hoja: el marco (título, tirador, cerrar) lo
// pone SelectorHoja, y hay UNA sola para los tres pasos — así el teclado no baja
// y sube entre marca y modelo. Ver GuessForm.
export default function SelectorLista({
  opciones,
  valor,
  onElegir,
  titulo,
  // Bandera del país de la marca, si el consumidor la sabe. Mismo dato que ya
  // enseñaba el combo de la web.
  optionFlag = null,
}) {
  const { t } = useT();
  const [q, setQ] = useState("");
  // Opción SEÑALADA por el teclado. Mismo mecanismo que el combo de la web (su
  // `hi`): un índice, no un ref al nodo — así sobrevive al refiltrado.
  const [hi, setHi] = useState(0);
  const listaRef = useRef(null);
  const buscarRef = useRef(null);
  const idBase = useId();
  // ¿Hay teclado a la vista? En la app no hay teclado físico, así que el foco
  // del buscador ES la señal, sin medir viewports ni escuchar al sistema. Es
  // además la definición que hace falta: lo que retira el índice A-Z no es «el
  // teclado ocupa píxeles», es «esta persona ha entrado a teclear».
  const [tecleando, setTecleando] = useState(false);

  const filtradas = useMemo(() => {
    const aguja = normalizar(q).trim();
    if (!aguja) return opciones;
    return opciones.filter((o) => normalizar(o).includes(aguja));
  }, [q, opciones]);

  // Agrupación por inicial: solo con la lista entera a la vista (buscando, el
  // orden que importa es el de la coincidencia, no el alfabético) y solo si hay
  // suficientes opciones para que el índice ayude.
  const grupos = useMemo(() => {
    if (q || opciones.length <= UMBRAL_INDICE) return null;
    const mapa = new Map();
    for (const o of filtradas) {
      // La inicial se toma NORMALIZADA: así "Škoda" cae en la S, que es donde
      // la busca cualquiera. Con la inicial cruda tendría letra propia al final
      // del índice y nadie la encontraría.
      const letra = (normalizar(o)[0] || "#").toUpperCase();
      if (!mapa.has(letra)) mapa.set(letra, []);
      mapa.get(letra).push(o);
    }
    return [...mapa.entries()];
  }, [filtradas, q, opciones.length]);

  // Las opciones EN EL ORDEN EN QUE SE VEN. Agrupada, la lista se pinta por
  // letras, así que recorrerla con las flechas siguiendo `filtradas` bajaría en
  // un orden distinto del que se lee en pantalla si algún día la fuente deja de
  // venir alfabética. Aplanando los grupos, el índice del teclado y el orden
  // visual son el mismo por construcción.
  const navegables = useMemo(
    () => (grupos ? grupos.flatMap(([, items]) => items) : filtradas),
    [grupos, filtradas]
  );

  // Índice de cada opción dentro de ese recorrido. Las marcas y los modelos son
  // cadenas únicas, así que sirven de clave directamente.
  const indiceDe = useMemo(() => {
    const m = new Map();
    navegables.forEach((o, i) => m.set(o, i));
    return m;
  }, [navegables]);

  // Al refiltrar, la señalada vuelve arriba: si se queda donde estaba, apunta a
  // una opción que ya no es la que se está mirando.
  useEffect(() => { setHi(0); }, [q]);

  // La señalada se trae a la vista sola. `nearest` para que no dé un salto
  // cuando ya se veía. Se busca por rol en vez de guardar refs de cada fila:
  // funciona igual con la lista plana y con la agrupada.
  //
  // La llamada va opcional (`?.()`, no solo `?.`) porque jsdom NO implementa
  // `scrollIntoView`: sin el guarda, el efecto lanzaba y se llevaba por delante
  // el componente entero en GuessForm.app.test.jsx — que es el único sitio donde
  // esta rama se ejecuta de verdad antes de un APK. Desplazar es un adorno; que
  // la lista se pinte, no.
  useEffect(() => {
    listaRef.current
      ?.querySelectorAll('[role="option"]')[hi]
      ?.scrollIntoView?.({ block: "nearest" });
  }, [hi]);

  // Elegir NO cierra la hoja: quien decide si queda algún paso por delante es
  // GuessForm, que es el único que sabe qué campos están vacíos.
  function elegir(o) {
    haptic.selection();
    onElegir(o);
  }

  // ── EL ÍNDICE SE RECORRE CON EL DEDO, no a toquecitos ──────────────────────
  // La tira A-Z tenía la forma del índice de la agenda pero no su gesto: había
  // que acertarle a una letra de 10px, soltar, mirar, y volver a acertarle a
  // otra. En la agenda del teléfono se apoya el dedo y se BAJA, y la lista va
  // pasando debajo — que es lo que convierte 80 marcas en un movimiento en vez
  // de en una puntería. Sin arrastre, un índice de letras diminutas es casi
  // peor que no tenerlo: promete precisión y la cobra.
  const indiceRef = useRef(null);
  const arrastrando = useRef(false);
  // La última letra a la que saltamos. Hace dos trabajos: no repetir el salto en
  // cada `pointermove` (llegan a decenas por segundo) y que el háptico marque el
  // CAMBIO de letra, que es la información que el dedo va buscando.
  const ultimaLetra = useRef(null);
  // Solo mientras el dedo está apoyado: un indicador que se quedara puesto
  // mentiría en cuanto la lista se desplace por su cuenta.
  const [letraActiva, setLetraActiva] = useState(null);

  // Qué letra cae bajo una coordenada Y. Se calcula por PROPORCIÓN sobre el alto
  // de la tira, no preguntando qué elemento hay en ese punto: al arrastrar, el
  // dedo se sale de la tira hacia los lados constantemente, y con
  // `elementFromPoint` el gesto se moriría en cuanto eso pasara. Con la
  // proporción, lo único que importa es a qué ALTURA está.
  function letraEnY(y) {
    const nav = indiceRef.current;
    if (!nav || !grupos?.length) return null;
    const r = nav.getBoundingClientRect();
    if (!r.height) return null;
    const i = Math.floor(((y - r.top) / r.height) * grupos.length);
    return grupos[Math.min(Math.max(i, 0), grupos.length - 1)][0];
  }

  function recorrer(y) {
    const letra = letraEnY(y);
    if (!letra || letra === ultimaLetra.current) return;
    setLetraActiva(letra);
    irALetra(letra);
  }

  function alPulsarIndice(e) {
    // Capturar el puntero es lo que mantiene vivo el gesto cuando el dedo se va
    // de la tira: sin esto, los `pointermove` dejan de llegar en cuanto sale.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    arrastrando.current = true;
    ultimaLetra.current = null;
    recorrer(e.clientY);
  }

  function alSoltarIndice() {
    arrastrando.current = false;
    ultimaLetra.current = null;
    setLetraActiva(null);
  }

  function irALetra(letra) {
    // Un toque suelto dispara `pointerdown` Y `click` sobre la misma letra, así
    // que sin esta guarda el mismo salto sonaría dos veces.
    if (letra !== ultimaLetra.current) haptic.selection();
    ultimaLetra.current = letra;
    // `scrollIntoView` se desplaza sobre el ancestro desplazable más cercano,
    // que es el cuerpo de la hoja: no hay que pasarse refs entre componentes.
    listaRef.current
      ?.querySelector(`[data-letra="${letra}"]`)
      ?.scrollIntoView?.({ block: "start" });
  }

  // LA VÍA DE TECLADO COMPLETA: bajar, subir y elegir sin tocar la pantalla.
  //
  // Antes esto solo atendía a Enter, y elegía siempre la PRIMERA coincidencia.
  // Con el buscador autoenfocándose por encima de 12 opciones, eso dejaba a
  // quien escribe en un callejón: teclear «se», ver que la que quiere es la
  // tercera y no tener ninguna forma de llegar a ella salvo levantar la mano y
  // tocarla. Las flechas son lo que hace que teclear sea de verdad un camino, y
  // no un atajo que se rinde a mitad. Es además exactamente lo que ya hacía el
  // combo de la web (su `onKey`), así que la hoja deja de ser accesiblemente más
  // pobre que aquello que vino a sustituir.
  function alTeclear(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, navegables.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (navegables[hi]) elegir(navegables[hi]);
    }
    // Escape no se toca: lo recoge SelectorHoja (useEscape) y cierra la hoja
    // entera, que es lo que se espera de un diálogo.
  }

  const opcion = (o) => {
    const i = indiceDe.get(o);
    return (
      <li
        key={o}
        id={`${idBase}-o${i}`}
        role="option"
        aria-selected={o === valor}
        className={"pm-opcion" + (o === valor ? " elegida" : "") + (i === hi ? " hi" : "")}
        onClick={() => elegir(o)}
        // Con el ratón, señalar lo que hay debajo del cursor mantiene una sola
        // idea de "la que está a punto de elegirse" — si no, el teclado señala
        // una y el clic cae en otra.
        onMouseEnter={() => setHi(i)}
      >
        <span className="pm-opcion-texto">{o}</span>
        {optionFlag?.(o) && (
          <img className="bandera" src={optionFlag(o)} alt="" draggable={false} loading="lazy" />
        )}
      </li>
    );
  };

  return (
    <>
      <div className="pm-buscar">
        <input
          ref={buscarRef}
          className="pm-buscar-campo"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={alTeclear}
          // El cambio de modo. `onBlur` importa tanto como `onFocus`: bajar el
          // teclado sin haber escrito nada tiene que devolver el índice, o el
          // modo lista se perdería hasta cerrar y reabrir la hoja.
          onFocus={() => setTecleando(true)}
          onBlur={() => setTecleando(false)}
          placeholder={t("cdd.selectorSearch")}
          enterKeyHint="search"
          // El buscador MANDA sobre la lista, y hay que decirlo: sin esto un
          // lector de pantalla lee un campo de texto suelto y una lista aparte,
          // así que las flechas mueven algo que no anuncia nada. Con el patrón
          // combobox, cada ↑/↓ lee en voz alta la opción señalada.
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={`${idBase}-lista`}
          aria-activedescendant={navegables[hi] ? `${idBase}-o${hi}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
        />
      </div>

      <div className="pm-lista-caja">
        <ul id={`${idBase}-lista`} className="pm-lista" role="listbox" aria-label={titulo} ref={listaRef}>
          {filtradas.length === 0 && <li className="pm-opcion vacia">{t("cdd.noMatches")}</li>}

          {grupos
            ? grupos.map(([letra, items]) => (
                <li key={letra} className="pm-grupo">
                  <p className="pm-grupo-letra" data-letra={letra}>{letra}</p>
                  <ul role="group" aria-label={letra}>{items.map(opcion)}</ul>
                </li>
              ))
            : filtradas.map(opcion)}
        </ul>

        {/* LA TIRA A-Z VIVE MIENTRAS NO HAYA TECLADO. `grupos` (el dato) no
            sabe nada de esto: sigue existiendo con la lista larga y sin filtrar,
            y lo que se condiciona es PINTAR la tira. Así el modo teclado
            conserva las iniciales pegajosas que dicen por dónde vas y solo
            pierde lo que no cabe. Y que la tira desaparezca es, de paso, el
            acuse de recibo de que has cambiado de modo. */}
        {grupos && !tecleando && (
          <nav
            ref={indiceRef}
            className="pm-indice"
            aria-label={t("cdd.selectorIndex")}
            // ESTA TIRA ES DUEÑA DE SU GESTO VERTICAL, y hay que decirlo hacia
            // fuera: sus toques burbujean hasta `.pm-hoja`, donde vive el
            // arrastre de la hoja entera (useArrastreHoja), que sin esto los
            // daba por suyos — bajar por el índice saltaba de letra Y arrastraba
            // la hoja, y pasado el 28% se la llevaba por delante.
            //
            // Un atributo y no el `touch-action: none` de aquí abajo, que dice
            // lo mismo: leer estilos calculados en cada `touchstart` es caro y
            // se rompe solo en cuanto alguien reorganice el CSS. Esto se lee en
            // el JSX y sale en el inspector.
            data-gesto-propio=""
            // El gesto vive en la TIRA, no en cada letra: al arrastrar, el dedo
            // pasa por los huecos entre botones y por fuera del borde, y ahí no
            // hay ningún botón que escuche.
            onPointerDown={alPulsarIndice}
            onPointerMove={(e) => { if (arrastrando.current) recorrer(e.clientY); }}
            onPointerUp={alSoltarIndice}
            onPointerCancel={alSoltarIndice}
          >
            {grupos.map(([letra]) => (
              <button
                key={letra}
                type="button"
                className={"pm-indice-letra" + (letra === letraActiva ? " activa" : "")}
                onClick={() => irALetra(letra)}
                // FUERA DEL TABULADOR, y es una decisión, no un descuido: son
                // ~26 paradas que hay que atravesar para llegar a la lista, y no
                // llevan a ningún sitio nuevo —el índice solo DESPLAZA, no elige
                // nada—. Quien va con teclado tiene el camino bueno y completo
                // en el buscador: escribir y bajar con las flechas alcanza
                // cualquier opción sin pasar por aquí.
                // Sigue siendo un <button>: TalkBack no usa el orden de
                // tabulación, así que con el cursor virtual se recorre y se
                // activa igual que antes.
                tabIndex={-1}
              >
                {letra}
              </button>
            ))}
          </nav>
        )}
      </div>
    </>
  );
}
