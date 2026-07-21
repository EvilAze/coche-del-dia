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
  blurred = false,
  overlay = null,
  progress = null,
  onRevealLoad,
}) {
  const { t } = useT();
  const revealed = status !== "playing";

  return (
    <section className="prensa-area-foto flex flex-col gap-2">
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
          blurred={blurred}
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
