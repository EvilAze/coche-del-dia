// src/components/HowToPlayModal.jsx
// Modal "Cómo se juega" — explica las mecánicas SIN bloquear la entrada.
// Se abre solo a petición (botón "?" en la esquina de la imagen), nunca
// automáticamente: un modal forzado al entrar añade fricción y cuesta
// engagement en un juego de "entra y juega". Patrón estilo Cardle.

import { useEscape } from "../hooks/useEscape";
import { useT } from "../i18n";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";

function Rule({ title, children }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="pm-dot" />
      <div className="min-w-0">
        <p className="pm-body pm-strong">{title}</p>
        <p className="pm-body mt-0.5">{children}</p>
      </div>
    </li>
  );
}

export default function HowToPlayModal({ open, onClose }) {
  const { t } = useT();
  useEscape(open, onClose);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={t("howto.title")}
      backdropClassName="modal-scrim fixed inset-0 z-[85] flex items-center justify-center px-4 py-4"
      panelClassName="modal-panel-flat w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain p-5"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="pm-kicker">{t("howto.tag")}</p>
          <h2 className="pm-title mt-1">{t("howto.title")}</h2>
        </div>
        <CloseButton onClick={onClose} />
      </div>

      <p className="pm-body mb-5">{t("howto.intro")}</p>

      <ul className="space-y-3.5">
        <Rule title={t("howto.rule1Title")}>{t("howto.rule1")}</Rule>
        <Rule title={t("howto.rule2Title")}>{t("howto.rule2")}</Rule>
        <Rule title={t("howto.rule3Title")}>{t("howto.rule3")}</Rule>
        <Rule title={t("howto.rule4Title")}>{t("howto.rule4")}</Rule>
        {/* Cinco reglas y ni una más. Hubo una sexta, la del escudo de racha:
            era la más larga de todas (tres cláusulas: cuántos tienes, cómo se
            ganan, qué no cubren) para explicar una excepción de la regla 5. Que
            la letra pequeña de una mecánica ocupe el triple que la regla del
            juego es la señal de que la mecánica sobra; se retiró entera (ver
            scripts/2026-08-retirar-escudo-racha.sql). */}
        <Rule title={t("howto.rule5Title")}>{t("howto.rule5")}</Rule>
      </ul>

      <button type="button" onClick={onClose} className="pm-btn mt-6">
        {t("howto.cta")}
      </button>
    </ModalShell>
  );
}
