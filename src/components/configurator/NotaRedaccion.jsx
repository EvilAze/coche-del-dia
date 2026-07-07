// src/components/configurator/NotaRedaccion.jsx
// Aviso ONE-TIME del rediseño «Prensa del motor»: un periódico anunciando su
// propia remodelación, como manda la tradición. Se muestra una única vez por
// navegador (flag en localStorage, lectura SÍNCRONA en el initializer para no
// parpadear) y jamás vuelve a molestar. Sin tono de disculpa: la racha, el
// garaje y las reglas siguen donde estaban, y eso es exactamente lo que dice.

import { useState } from "react";
import { useT } from "../../i18n";

const FLAG = "cdd_nota_prensa_v1";

export default function NotaRedaccion() {
  const { t } = useT();
  const [open, setOpen] = useState(() => {
    try {
      return !localStorage.getItem(FLAG);
    } catch {
      // Sin localStorage (Safari privado antiguo): mejor no enseñarla que
      // enseñarla en cada visita.
      return false;
    }
  });

  if (!open) return null;

  const cerrar = () => {
    try { localStorage.setItem(FLAG, "1"); } catch { /* best-effort */ }
    setOpen(false);
  };

  return (
    <div className="prensa-nota" role="dialog" aria-modal="true" aria-label={t("prensa.notaTitulo")}>
      <div className="prensa-nota-scrim" onClick={cerrar} />
      <div className="prensa-nota-panel">
        <div className="prensa-cupon-cab">{t("prensa.notaTitulo")}</div>
        <p className="titular">{t("prensa.notaTitular")}</p>
        <p className="cuerpo">{t("prensa.notaCuerpo")}</p>
        <button className="prensa-submit" onClick={cerrar}>{t("prensa.notaCta")}</button>
      </div>
    </div>
  );
}
