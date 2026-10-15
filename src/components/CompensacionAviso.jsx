// Aviso de UNA vez para quien el 15-oct no pudo elegir el coche del día.
//
// Qué pasó: la marca salía duplicada («TVR» / «Tvr») y bajo una de las dos no
// estaba el modelo. La partida se les compensó en el servidor
// (scripts/2026-10-15-compensacion-tvr-aplicar.sql); esto es la otra mitad:
// que se ENTEREN. Un arreglo que nadie ve se queda en «el juego me robó la
// racha», que es justo lo que había que deshacer.
//
// Es un diálogo de DECISIÓN (regla 24): se lee y se vuelve, así que tarjeta
// centrada en las dos plataformas, con ModalShell a pelo.
//
// Los datos llegan de la RPC mi_compensacion_tvr (solo la fila de quien
// pregunta). Las cifras se cuentan porque son lo que convence: «perdón» a
// secas no devuelve nada; «tu racha sigue en 14» sí.
//
// TEMPORAL: quitar junto a sus RPC una semana después (ver el .sql del aviso).

import { useT } from "../i18n";
import { useEscape } from "../hooks/useEscape";
import ModalShell from "./ModalShell";
import CloseButton from "./CloseButton";

export default function CompensacionAviso({ datos, onClose }) {
  const { t } = useT();
  const open = Boolean(datos);
  useEscape(open, onClose);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={t("compensacion.titulo")}
      backdropClassName="modal-scrim safe-area-pad fixed inset-0 z-dialogo flex items-center justify-center px-4"
      panelClassName="modal-panel-flat relative w-full max-w-sm max-h-full overflow-y-auto overscroll-contain"
    >
      {datos && (
        <div className="dlg">
          <div className="dlg-cab">
            <h2 className="dlg-titulo">{t("compensacion.titulo")}</h2>
            <CloseButton onClick={onClose} />
          </div>
          <p className="dlg-texto">{t("compensacion.quepaso")}</p>
          <p className="dlg-texto">
            {t("compensacion.loquehicimos", { intento: datos.intento })}
          </p>
          {/* Las dos cifras, con el mismo formato de «trato» que el borrado de
              cuenta: se leen de un vistazo, antes que un párrafo. */}
          <dl className="dlg-trato">
            <div>
              <dt>{t("compensacion.puntos")}</dt>
              <dd>+{datos.puntos}</dd>
            </div>
            <div>
              <dt>{t("compensacion.racha")}</dt>
              <dd>{datos.racha}</dd>
            </div>
          </dl>
          <div className="dlg-botones">
            <button type="button" onClick={onClose} className="pm-btn">
              {t("compensacion.vale")}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
