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

import { useEffect, useMemo, useRef, useState } from "react";
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
  const listaRef = useRef(null);
  const buscarRef = useRef(null);

  const autoFoco = opciones.length > UMBRAL_AUTOFOCO;

  // El foco va SÍNCRONO en el efecto, no diferido a un rAF ni a un setTimeout.
  // En Android, un `focus()` programático solo levanta el teclado si sigue
  // dentro de la tarea que nació del toque del usuario; aplazarlo un frame deja
  // el campo enfocado y el teclado abajo. Es de esos fallos que en escritorio no
  // existen y en un móvil se ven siempre.
  useEffect(() => {
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
      ?.scrollIntoView({ block: "start" });
  }

  // Enter en el buscador elige la primera coincidencia. Es la vía de teclado
  // completa —teclear y enviar sin tocar la pantalla— y de paso hace que el
  // buscador se comporte como espera quien viene de la web.
  function alTeclear(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (filtradas.length > 0) elegir(filtradas[0]);
  }

  const opcion = (o) => (
    <li
      key={o}
      role="option"
      aria-selected={o === valor}
      className={"pm-opcion" + (o === valor ? " elegida" : "")}
      onClick={() => elegir(o)}
    >
      <span className="pm-opcion-texto">{o}</span>
      {optionFlag?.(o) && (
        <img className="bandera" src={optionFlag(o)} alt="" draggable={false} loading="lazy" />
      )}
    </li>
  );

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
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
        />
      </div>

      <div className="pm-lista-caja">
        <ul className="pm-lista" role="listbox" aria-label={titulo} ref={listaRef}>
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
