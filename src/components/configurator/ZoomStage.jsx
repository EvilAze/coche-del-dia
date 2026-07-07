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
            : t("prensa.pista", { n: Math.min(hintIndex + 1, totalHints), max: totalHints })}
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

      {/* Pie de foto: la cursiva editorial narra; los pips cuentan. */}
      <div className="prensa-pie">
        <span>{t(revealed ? "prensa.pieFotoFin" : "prensa.pieFoto")}</span>
        {progress}
      </div>
    </section>
  );
}
