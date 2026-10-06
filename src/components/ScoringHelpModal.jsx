// src/components/ScoringHelpModal.jsx
// CÓMO SE PUNTÚA — la ayuda de la clasificación. Las mismas dos piezas que el
// tercer paso de «Cómo se juega» (Puntuacion.jsx): la curva de puntos por
// intento y la escalera del bonus de racha, con su explicación encima.
import { useEscape } from "../hooks/useEscape";
import { useT } from "../i18n";
import CloseButton from "./CloseButton";
import Superficie from "./Superficie";
import { TablaPuntos, EscaleraRacha } from "./Puntuacion";

export default function ScoringHelpModal({ open, onClose }) {
  const { t } = useT();
  useEscape(open, onClose);

  return (
    <Superficie
      open={open}
      onClose={onClose}
      // Nombre accesible: sin él, quien usa lector de pantalla oía «diálogo» a
      // secas.
      label={t("scoring.tag")}
      // Encaje de modal alto: `safe-area-pad` en el velo + `max-h-full` en el
      // panel (el porqué, en index.css junto a `.safe-area-pad`).
      veloWeb="modal-scrim safe-area-pad fixed inset-0 z-[90] flex items-center justify-center px-4"
      veloApp="pm-velo-hoja fixed inset-0 z-[90] flex items-end justify-center"
      panelWeb="modal-panel-flat panel-seccion w-full max-w-md max-h-full overflow-y-auto overscroll-contain p-5"
    >
      <div className="clas-cab">
        <h2 className="clas-titulo">{t("scoring.tag")}</h2>
        <CloseButton onClick={onClose} label={t("common.close")} />
      </div>

      <section className="pun-seccion">
        <h3 className="pun-titulo">{t("scoring.basePointsHeader")}</h3>
        <p className="pun-texto">{t("scoring.basePointsBody")}</p>
        <TablaPuntos />
      </section>

      <section className="pun-seccion">
        <h3 className="pun-titulo">{t("scoring.bonusHeader")}</h3>
        <p className="pun-texto">{t("scoring.bonusBody")}</p>
        <EscaleraRacha />
        <p className="pun-nota">{t("scoring.bonusFootnote")}</p>
      </section>
    </Superficie>
  );
}
