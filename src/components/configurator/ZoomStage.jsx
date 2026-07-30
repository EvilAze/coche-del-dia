// src/components/configurator/ZoomStage.jsx
// Escenario «Prensa del motor»: ladillo editorial ("La fotografía del día" +
// pista N de M), foto con paspartú y filete (lo pinta la capa .prensa sobre
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
      <div className="prensa-ladillo">
        {t("prensa.ladilloFoto")}
        <span className="aparte">
          {revealed
            ? t("prensa.edicionCerrada")
            : // hintIndex null = modo sin pistas progresivas (Repesca veterano):
              // no pintamos contador de pista para no contradecir "sin pistas".
              // El daily y la repesca normal siempre pasan un índice numérico.
              hintIndex != null
              ? t("prensa.pista", { n: Math.min(hintIndex + 1, totalHints), max: totalHints })
              : null}
        </span>
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

      {/* Pie de foto: SOLO al revelar (remate editorial del momento pico). Durante
          el juego era una cursiva de 9,5px que se repetía idéntica cada día y
          competía con el contador de intentos — se retira. Los pips (cuando el
          flujo los pasa, p.ej. Repesca) siguen a la derecha en ambos estados. */}
      {(revealed || progress) && (
        <div className="prensa-pie">
          {revealed && <span className="pie-cap">{t("prensa.pieFotoFin")}</span>}
          {progress}
        </div>
      )}
    </section>
  );
}
