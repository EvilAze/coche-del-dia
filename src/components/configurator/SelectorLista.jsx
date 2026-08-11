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
// EL BUSCADOR SE AUTOENFOCA CUANDO LA LISTA ES LARGA, y esto es la corrección
// de una regla mía anterior que estaba mal aplicada.
//
// La primera versión NO lo enfocaba nunca, razonando que el teclado se comería
// media pantalla. Ese razonamiento era correcto para la PANTALLA DE JUEGO —ahí
// el teclado destrozaba la maqueta y tapaba la fotografía— y no vale aquí:
// dentro de la hoja el teclado no cuesta nada. No hay pliego que recomponer, la
// foto ya está detrás y la hoja mide en `dvh`, así que encoge sola y se apoya
// en el teclado.
//
// Con el campo enfocado al abrir, la hoja es un SUPERCONJUNTO de teclear:
//   · Si sabes lo que buscas: tres letras y tocas. Menos gestos que en la web,
//     porque no hay que apuntar primero al campo.
//   · Si no lo sabes: bajas el teclado y tienes la lista entera con su índice.
// Es el patrón del buscador de contactos, del conmutador de canales de Slack y
// del «¿a dónde vamos?» de un mapa: campo enfocado ARRIBA y lista debajo, no
// una cosa o la otra. Obligar a elegir entre las dos castiga siempre a alguien:
// a quien sabe lo que quiere, o a quien viene a mirar qué hay.
//
// Filtrado sin tildes ni mayúsculas (lib/texto), el mismo criterio que el combo
// de la web: "citroen" tiene que encontrar "Citroën".

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { haptic } from "../../lib/haptics";
import { normalizar } from "../../lib/texto";
import { useT } from "../../i18n";

// A partir de aquí la lista deja de leerse de un vistazo y entra el índice.
// Medido a ojo sobre una pantalla de móvil: ~10 opciones visibles, así que 25
// son dos pantallas y media — el punto donde uno empieza a arrastrar sin saber
// cuánto queda.
const UMBRAL_INDICE = 25;

// Y a partir de aquí compensa levantar el teclado solo. Por debajo —los cinco
// modelos de una marca— la lista entera cabe en pantalla: enfocar el buscador
// taparía con el teclado justo lo que se venía a mirar.
const UMBRAL_AUTOFOCO = 12;

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

  const autoFoco = opciones.length > UMBRAL_AUTOFOCO;

  // El foco tiene que caer DENTRO de la tarea que nació del toque del usuario:
  // en Android un `focus()` programático solo levanta el teclado si sigue en
  // ella, y si se aplaza queda el campo enfocado y el teclado abajo. Es de esos
  // fallos que en escritorio no existen y en un móvil se ven siempre.
  //
  // Por eso `useLayoutEffect` y no `useEffect`: este comentario decía que el
  // efecto era síncrono, y no lo era. `useEffect` se AGENDA tras el pintado, o
  // sea justo el aplazamiento que el párrafo de arriba dice que no se puede
  // hacer; el que corre síncrono dentro del commit —y por tanto dentro de la
  // tarea del toque, porque React vacía las actualizaciones de un click de forma
  // síncrona— es `useLayoutEffect`. Funcionaba de milagro y por dispositivo.
  useLayoutEffect(() => {
    if (autoFoco) buscarRef.current?.focus();
  }, [autoFoco]);

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

  function irALetra(letra) {
    haptic.selection();
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

        {grupos && (
          <nav className="pm-indice" aria-label={t("cdd.selectorIndex")}>
            {grupos.map(([letra]) => (
              <button
                key={letra}
                type="button"
                className="pm-indice-letra"
                onClick={() => irALetra(letra)}
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
