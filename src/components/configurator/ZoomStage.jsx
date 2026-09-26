// src/components/configurator/ZoomStage.jsx
// Escenario «Prensa del motor»: ladillo editorial (la pregunta del juego +
// intento N de M), foto con paspartú y filete (lo pinta la capa .prensa sobre
// .cdd-stage-frame; el HUD/grano del sistema anterior queda oculto por CSS y
// se retira físicamente en F5) y pie de foto en cursiva con los pips de
// intentos a la derecha. La foto la sigue pintando CarImage en modo
// `configurator` (pipeline/seguridad intactos, regla 6: srcset sin tocar).

import CarImage from "../CarImage";
import { useT } from "../../i18n";

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

  // El texto VIVO del ladillo: el intento en curso o el cierre de la partida.
  // `hintIndex` null = modo sin pistas progresivas (Repesca veterano): no se
  // pinta contador, para no contradecir el «sin pistas» que promete ese modo.
  // (Decía «Pista 1 de 5»: llamaba pista a la fotografía, que es el acertijo, y
  // contaba intentos con la palabra de otra cosa.)
  const estado = revealed
    ? t("prensa.edicionCerrada")
    : hintIndex != null
      ? t("prensa.pista", { n: Math.min(hintIndex + 1, totalHints), max: totalHints })
      : null;

  // ── EL RÓTULO ES LA PREGUNTA DEL JUEGO ────────────────────────────────────
  // Aquí ponía «La fotografía del día», y en la app ni eso: se retiró por
  // nombrar lo evidente —está encima de una fotografía— y la línea se quedó con
  // el estado a secas. El diagnóstico era bueno y la conclusión, corta: el
  // renglón no sobraba, le sobraba ESE texto. La pantalla no decía en ningún
  // sitio qué había que hacer (el único enunciado era el h1 `sr-only` de
  // Configurator) y los primeros cinco segundos de quien la abría por primera
  // vez eran literalmente «¿pero qué es esto?». La pregunta cuesta el mismo
  // renglón y es la única frase que un recién llegado necesita leer.
  //
  // En la misma voz que el resto de titulares (Fraunces, en caja baja), no en
  // versalitas espaciadas: es la frase que se lee, no una etiqueta de sección.
  // Con la partida cerrada ya no hay nada que preguntar y vuelve el rótulo de
  // siempre.
  const rotulo = revealed ? t("prensa.ladilloFoto") : t("prensa.pregunta");

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
      {/* Pregunta a la izquierda, estado al final del filete. El filete es un
          elemento de verdad y no el `::after` de siempre porque el estado va
          DESPUÉS de la regla, y un pseudo-elemento siempre va el último. */}
      <div className="prensa-ladillo prensa-ladillo--pregunta">
        <span className="rotulo">{rotulo}</span>
        <i className="filete" aria-hidden="true" />
        {/* EL CONTADOR SE RE-ESTAMPA AL CAMBIAR DE INTENTO. Es el relevo
            tipográfico del lavado rojo que se tiraba sobre la fotografía (ver
            CarImage): en este sistema el aviso lo da la letra, no un tinte
            encima de la foto. El `key` es el propio texto, así que al pasar de
            «Intento 2 de 5» a «Intento 3 de 5» React sustituye el nodo y la
            animación del sello vuelve a arrancar — que es la única forma de
            re-disparar una keyframe CSS sin tocarla desde JS. Cae en el primer
            tiempo del compás, antes que la foto. */}
        {estado && <span key={estado} className="aparte prensa-estampada">{estado}</span>}
      </div>

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
          overlay={overlay}
          onRevealLoad={onRevealLoad}
        />
      </div>

      {/* La fila del pie existe para los pips (`progress`, los pasa la
          Repesca) y para el crédito de la temporada, y solo se monta si hay
          alguno de los dos.
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
              cuenta el zoom al abrirse, que es enseñarlo en vez de decirlo.

          EL CRÉDITO DE LA TEMPORADA VA AL PIE DE LA FOTO. Vivía al final del
          filete del ladillo, y ese sitio se lo ha quedado el estado ahora que el
          rótulo es la pregunta: pregunta, estado y crédito no caben juntos en
          360px. Debajo de la foto, además, es donde un periódico pone la firma
          de una fotografía de agencia — que es exactamente de lo que habla: de
          dónde salen los coches de estos días. Solo cuesta alto cuando hay
          temporada que acreditar. */}
      {(progress || credito) && (
        <div className="prensa-pie">
          {credito && <span className="presenta">{credito}</span>}
          {progress}
        </div>
      )}
    </section>
  );
}
