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
      <span
        aria-hidden="true"
        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_6px_rgba(122,240,200,0.5)]"
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-muted">{children}</p>
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
          <p className="text-[11px] uppercase tracking-[0.28em] text-accent">
            {t("howto.tag")}
          </p>
          <h2 className="font-display text-3xl tracking-widest text-white">
            {t("howto.title")}
          </h2>
        </div>
        <CloseButton onClick={onClose} />
      </div>

      <p className="mb-5 text-sm leading-relaxed text-white/80">
        {t("howto.intro")}
      </p>

      <ul className="space-y-3.5">
        <Rule title={t("howto.rule1Title")}>{t("howto.rule1")}</Rule>
        <Rule title={t("howto.rule2Title")}>{t("howto.rule2")}</Rule>
        <Rule title={t("howto.rule3Title")}>{t("howto.rule3")}</Rule>
        <Rule title={t("howto.rule4Title")}>{t("howto.rule4")}</Rule>
        <Rule title={t("howto.rule5Title")}>{t("howto.rule5")}</Rule>
      </ul>

      <button
        type="button"
        onClick={onClose}
        className="
          mt-6 w-full rounded-lg bg-accent px-4 py-3
          font-display text-base tracking-widest text-bg-primary
          transition-transform hover:scale-[1.02] active:scale-[0.98]
        "
      >
        {t("howto.cta")}
      </button>
    </ModalShell>
  );
}
