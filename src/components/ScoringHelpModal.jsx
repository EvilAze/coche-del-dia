import { useEscape } from "../hooks/useEscape";
import { useT } from "../i18n";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";

const BASE_POINTS = [
  { attempt: 1, points: 10 },
  { attempt: 2, points: 6 },
  { attempt: 3, points: 4 },
  { attempt: 4, points: 3 },
  { attempt: 5, points: 2 },
  { attempt: 6, points: 1 },
];

export default function ScoringHelpModal({ open, onClose }) {
  const { t } = useT();
  useEscape(open, onClose);

  // Las labels van por i18n; el resto (fuegos, bonus) son universales.
  const STREAK_BONUS = [
    { labelKey: "scoring.streakLabel2", fires: "🔥", bonus: "+1" },
    { labelKey: "scoring.streakLabel3", fires: "🔥🔥", bonus: "+2" },
    { labelKey: "scoring.streakLabel4plus", fires: "🔥🔥🔥", bonus: "+3" },
  ];

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      backdropClassName="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-4 py-4 backdrop-blur-sm"
      // max-h con 100dvh (dynamic viewport) para que en móvil con la barra
      // de URL desplegada el modal siga cabiendo. overflow-y-auto +
      // overscroll-contain para que el scroll quede aislado al modal y no
      // se propague al body al llegar al final del contenido.
      panelClassName="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[#101014] p-5 shadow-2xl"
    >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-accent">
              {t("scoring.tag")}
            </p>
            <h2 className="font-display text-3xl tracking-widest text-white">
              {t("scoring.title")}
            </h2>
          </div>

          <CloseButton onClick={onClose} />
        </div>

        <section className="mb-5">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
            {t("scoring.basePointsHeader")}
          </h3>
          <p className="mb-3 text-sm text-white/70">
            {t("scoring.basePointsBody")}
          </p>

          <div className="overflow-hidden rounded-xl border border-white/10">
            {BASE_POINTS.map((row, i) => (
              <div
                key={row.attempt}
                className={`
                  grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2.5
                  ${i % 2 === 0 ? "bg-white/[0.03]" : "bg-white/[0.01]"}
                  ${i > 0 ? "border-t border-white/5" : ""}
                `}
              >
                <span className="text-sm text-white/85">
                  {t("scoring.attempt")}{" "}
                  <span className="font-display text-base text-white">
                    {row.attempt}
                  </span>
                </span>
                <span className="font-display tabular-nums text-lg text-accent">
                  {row.points} {t("scoring.ptsSuffix")}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
            {t("scoring.bonusHeader")}
          </h3>
          <p className="mb-3 text-sm text-white/70">
            {t("scoring.bonusBody")}
          </p>

          <div className="grid grid-cols-3 gap-2">
            {STREAK_BONUS.map((row) => (
              <div
                key={row.labelKey}
                className="
                  flex flex-col items-center justify-center gap-1
                  rounded-xl border border-accent/20 bg-accent/[0.06] px-2 py-3
                "
              >
                <span className="text-lg leading-none tracking-tighter">
                  {row.fires}
                </span>
                <span className="text-[10px] uppercase tracking-widest text-muted">
                  {t(row.labelKey)}
                </span>
                <span className="font-display text-xl tabular-nums text-accent leading-none">
                  {row.bonus}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs text-muted">
            {t("scoring.bonusFootnote")}
          </p>
        </section>
    </ModalShell>
  );
}
