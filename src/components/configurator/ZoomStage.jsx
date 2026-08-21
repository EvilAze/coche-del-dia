// src/components/configurator/ZoomStage.jsx
// Escenario «Prensa del motor»: ladillo editorial ("La fotografía del día" +
// pista N de M), foto con paspartú y filete (lo pinta la capa .prensa sobre
// .cdd-stage-frame; el HUD/grano del sistema anterior queda oculto por CSS y
// se retira físicamente en F5) y pie de foto en cursiva con los pips de
// intentos a la derecha. La foto la sigue pintando CarImage en modo
// `configurator` (pipeline/seguridad intactos, regla 6: srcset sin tocar).

import CarImage from "../CarImage";
import { useT } from "../../i18n";
import { esApp } from "../../lib/plataforma";

export default function ZoomStage({
  car,
  zoom,
  status,
  hintIndex,
  totalHints,
  // (`blurred` se retiró: existía solo para emborronar el coche al anónimo que
  // perdía hasta que iniciara sesión, y ese muro ya no existe — ver «Política
  // de revelado» en api/validate-guess.js. Ningún consumidor lo pasaba a true
  // salvo aquel caso, así que la prop se va con él.)
  overlay = null,
  progress = null,
  // El crédito del final del filete: quién presenta la temporada («USPI ·
  // POWERART») o, si no hay colaboración, la temporada en curso («TEMPORADA ·
  // LE MANS»). Un solo hueco para las dos cosas porque son la misma frase — de
  // dónde salen los coches de estos días — y la prioridad la resuelve
  // Configurator, que es quien tiene la temporada y el idioma. Aquí solo se
  // pinta. null = línea de siempre.
  credito = null,
  onRevealLoad,
  // Ref opcional a la <section> del escenario. Lo usa Configurator para
  // observar (IntersectionObserver) cuándo la foto sale del viewport y
  // mostrar el "recorte" flotante (PhotoPeek). No se puede envolver la
  // sección en un div: la clase prensa-area-foto es la que engancha el
  // grid-area/order del pliego y un wrapper lo rompería.
  sectionRef = null,
}) {
  const { t } = useT();
  const revealed = status !== "playing";

  // El texto VIVO del ladillo: la pista en curso o el cierre de la edición.
  // `hintIndex` null = modo sin pistas progresivas (Repesca veterano): no se
  // pinta contador, para no contradecir el «sin pistas» que promete ese modo.
  const estado = revealed
    ? t("prensa.edicionCerrada")
    : hintIndex != null
      ? t("prensa.pista", { n: Math.min(hintIndex + 1, totalHints), max: totalHints })
      : null;

  // ── EN LA APP EL LADILLO SE QUEDA SOLO CON EL ESTADO ──────────────────────
  // «La fotografía del día» es un rótulo que nombra lo evidente: está encima de
  // una fotografía. Un ladillo se gana el sitio distinguiendo UNA sección entre
  // muchas en una página densa; en el pliego de la app no hay más que esto en
  // pantalla, así que gastaba un renglón entero —a peso 800 y en tinta plena—
  // para no decir nada, mientras el único dato que cambia según juegas («Pista
  // 1 de 5») iba de nota al margen, en gris y a peso 600. Estaba invertido: el
  // rótulo gritaba y el estado susurraba.
  //
  // Quitado el rótulo, el estado hereda la línea y su gramaje. En WEB no se
  // toca: allí el pliego es un documento que se lee bajando, con masthead y
  // varias secciones, y ahí el ladillo sí hace su trabajo de siempre.
  //
  // Y CUANDO NO HAY ESTADO, EN LA APP NO HAY LÍNEA. El caso es Repesca
  // Veterano, el único modo sin pista. Antes esa rama conservaba el rótulo
  // —para no dejar una línea en blanco con su filete—, pero conservarlo es
  // volver a poner «La fotografía del día» encima de una fotografía: el mismo
  // renglón que se retiró aquí por no decir nada, reaparecido justo en la
  // pantalla más desnuda de todas. Si no hay nada vivo que contar, la línea
  // entera se va y la foto sube.
  const enApp = esApp();
  const soloEstado = enApp && estado != null;
  // ...y si NO hay estado pero SÍ hay crédito, la línea se queda: el único modo
  // sin pista es la Repesca veterano, y ahí «la línea entera se va» dejaría al
  // patrocinador fuera justo en una de las pantallas del juego. Una atribución
  // que aparece según en qué modo estés no es una atribución.
  const sinLadillo = enApp && estado == null && !credito;

  return (
    // Sin sangría horizontal propia. La tenía (`px-4 md:px-8`) y era justo lo que
    // impedía la decisión de portada que index.css lleva documentada desde el
    // rediseño: en columna única el escenario rompe el margen del pliego con
    // `margin-inline: -18px` para TOCAR los dos bordes de la pantalla («la foto
    // ES el juego → gana el escenario»). Los 18px negativos se comían el margen
    // del pliego y estos 16px lo volvían a poner, así que la foto quedaba metida
    // 16px y la sangría no se veía nunca. De paso, el ladillo y el pie vuelven a
    // alinear con el margen del pliego —lo que promete el comentario del pie— en
    // vez de ir 16px por dentro de él.
    // El recorte 4:3 no se toca (reglas 5 y 7) y `sizes` es por viewport, no por
    // ancho del elemento: el navegador elige el MISMO recurso, así que el preload
    // del middleware sigue coincidiendo byte a byte (regla 6).
    <section ref={sectionRef} className="prensa-area-foto flex flex-col gap-3 pb-4">
      {/* EL CRÉDITO VA AL FINAL DEL FILETE, no en un renglón propio. Esta
          línea ya dibuja una regla que llena lo que sobra del ancho, así que el
          rótulo de la temporada cabe en su extremo derecho sin costar un píxel
          de alto: estado vivo a la izquierda, temporada a la derecha.
          Darle banda propia habría sido volver a poner un rótulo fijo encima de
          la foto — exactamente el renglón que se retiró de aquí por no decir
          nada (ver el bloque de arriba).
          Con `credito` el filete deja de ser el `::after` del CSS y pasa a ser
          un elemento de verdad, porque un pseudo-elemento siempre va el último
          y aquí necesitamos algo DESPUÉS de la regla.

          El rótulo va en su propio <span> —antes era un nodo de texto suelto—
          para que el CSS pueda retirarlo en pantalla estrecha cuando el crédito
          ocupa el otro extremo. Sin eso, «La fotografía del día» y «Temporada ·
          Bombas de bolsillo» no caben juntos en un móvil de 360 y la línea
          rompía en dos renglones, que es justo el píxel de alto que este diseño
          no quiere gastar. De los dos textos, el que cede es el que nombra lo
          evidente. */}
      {!sinLadillo && (
        <div
          className={
            "prensa-ladillo" +
            (soloEstado ? " solo-estado" : "") +
            (credito ? " con-presenta" : "")
          }
        >
          {!soloEstado && <span className="rotulo">{t("prensa.ladilloFoto")}</span>}
          <span className="aparte">{estado}</span>
          {credito && (
            <>
              <i className="filete" aria-hidden="true" />
              <span className="presenta">{credito}</span>
            </>
          )}
        </div>
      )}

      {/* UN solo marco. Aquí había un segundo paspartú en utilidades (padding,
          `bg-papel-mat`, `border-border` y `shadow-sm`) montado ALREDEDOR del
          marco real, que lo pinta `.prensa .cdd-stage-frame` en index.css con su
          papel, su filete de tinta plena y sus 8px de paspartú. Dos marcos
          concéntricos, y encima al revés de como se lee un cuadro: el filete de
          fuera (tinta al 22%) más flojo que el de dentro (tinta plena). La
          `shadow-sm` era además la última sombra blanda de Tailwind en la
          pantalla de juego, donde el sistema separa con filetes.
          El marco vivo sigue siendo `.cdd-stage-frame`: es la pieza que fija el
          4:3 y la que busca useEncajeEscenario. */}
      {/* `data-escenario` es el asidero de useEscenarioApartado, que mide ESTA
          caja —la de fuera, la que nunca se transforma— para saber cuánto tiene
          que apartarse la foto cuando se abre la hoja de selección de la app.
          Va aquí y no en el marco a propósito: el `transform` lo lleva el marco
          de dentro (.cdd-stage-frame), así que medir el de fuera devuelve
          siempre la posición de maqueta y no una posición en vuelo a media
          animación. Si algún día el marco deja de ocupar esta caja entera, esa
          cuenta deja de valer. */}
      <div
        className={"cdd-stage" + (revealed ? " revealed" : "")}
        data-escenario=""
      >
        <CarImage
          configurator
          src={car?.img ?? null}
          blurData={car?.blurData ?? null}
          zoom={zoom}
          hintIndex={hintIndex}
          totalHints={totalHints}
          status={status}
          showHintLabel={false}
          overlay={overlay}
          onRevealLoad={onRevealLoad}
        />
      </div>

      {/* La fila del pie ya SOLO existe para los pips, y por eso se gatea con
          `progress` (los pasa la Repesca; el daily, no).
          Aquí iba además un pie de foto al revelar: «El ejemplar de hoy, por fin a
          plena página». Se retira por tres motivos que se acumularon:
            · Era MENTIRA desde que la foto va enmarcada. Ese «a plena página»
              describía literalmente la sangría —el index.css llegó a decir que la
              sangría «cumple la promesa que ya hacía el pie»—, y la sangría se
              retiró: la foto vive dentro del margen del pliego.
            · Lo repetía. En el mismo instante en que aparecía, el ladillo de esta
              misma sección ya decía «La fotografía del día · Edición cerrada».
              Dos renglones anunciando lo mismo, uno encima y otro debajo de la
              foto.
            · Un pie de periódico describe ESA fotografía; este describía la
              maquetación, y con las mismas palabras cada día. Era decoración
              disfrazada de contenido. Lo que dice —«ya puedes verlo entero»— ya lo
              cuenta el zoom al abrirse, que es enseñarlo en vez de decirlo. */}
      {progress && <div className="prensa-pie">{progress}</div>}
    </section>
  );
}
