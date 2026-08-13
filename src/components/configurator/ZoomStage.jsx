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
  // El `estado != null` NO es defensivo de más: es exactamente el caso de
  // Repesca Veterano, que no tiene pista. Sin esa guarda, ese modo se quedaba
  // con un ladillo vacío —una línea en blanco y su filete— en vez de un rótulo.
  const soloEstado = esApp() && estado != null;

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
      <div className={"prensa-ladillo" + (soloEstado ? " solo-estado" : "")}>
        {!soloEstado && t("prensa.ladilloFoto")}
        <span className="aparte">{estado}</span>
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
      <div className={"cdd-stage" + (revealed ? " revealed" : "")}>
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
