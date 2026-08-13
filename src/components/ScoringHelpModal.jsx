import { useEscape } from "../hooks/useEscape";
import { useT } from "../i18n";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";
import AchievementIcon from "./AchievementIcons";

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

  // Escalera de racha en lenguaje prensa: tres niveles que escalan por
  // TIPOGRAFÍA y tinta (sin glows). Las llamas línea-arte se conservan
  // (coherencia con Logros); el calor sube de tinta apagada a ORO VIEJO —
  // la racha es "lo acumulado", territorio premium del spec §2.
  const STREAK_BONUS = [
    { labelKey: "scoring.streakLabel2", icon: "spark", bonus: "+1", iconColor: "text-tinta-2/60" },
    { labelKey: "scoring.streakLabel3", icon: "spark_double", bonus: "+2", iconColor: "text-tinta-2" },
    { labelKey: "scoring.streakLabel4plus", icon: "blaze", bonus: "+3", iconColor: "text-oro-viejo", peak: true },
  ];

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      // Encaje de modal alto: `safe-area-pad` en el backdrop + `max-h-full` en el
      // panel (el porqué, en index.css junto a `.safe-area-pad`). El tope era un
      // `calc(100dvh - 2rem)`: resolvía lo de la barra de URL del móvil —que es
      // lo que 100dvh sabe hacer— pero no lo de las barras de la app, porque el
      // dynamic viewport las INCLUYE. Topar contra la caja del backdrop cubre las
      // dos cosas: es `fixed inset-0`, así que ya sigue a la barra de URL, y el
      // padding le descuenta los insets del sistema.
      // overflow-y-auto + overscroll-contain: el scroll queda aislado al modal y
      // no se propaga al body al llegar al final del contenido.
      backdropClassName="modal-scrim safe-area-pad fixed inset-0 z-[90] flex items-center justify-center px-4"
      panelClassName="modal-panel-flat w-full max-w-md max-h-full overflow-y-auto overscroll-contain p-5"
    >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="pm-kicker">{t("scoring.tag")}</p>
            <h2 className="pm-title mt-1">{t("scoring.title")}</h2>
          </div>

          <CloseButton onClick={onClose} />
        </div>

        <section className="mb-5">
          <h3 className="pm-label mb-2">{t("scoring.basePointsHeader")}</h3>
          <p className="pm-body mb-3">{t("scoring.basePointsBody")}</p>

          {/* Tarifario con puntos conductores, como una lista de precios */}
          <div>
            {BASE_POINTS.map((row) => (
              <div
                key={row.attempt}
                className="flex items-baseline gap-2 border-b border-dotted border-tinta-2/60 py-2"
              >
                <span className="pm-body pm-strong">
                  {t("scoring.attempt")} {row.attempt}
                </span>
                <span className="flex-1" />
                <span className="font-courier tabular-nums text-base font-bold text-tinta">
                  {row.points} {t("scoring.ptsSuffix")}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="pm-label mb-2">{t("scoring.bonusHeader")}</h3>
          <p className="pm-body mb-3">{t("scoring.bonusBody")}</p>

          {/* Tres viñetas con filete: la cúspide (racha 4+) lleva el filete
              de ORO VIEJO — sin glows ni raíles de gradiente. */}
          <div className="grid grid-cols-3 gap-2 border border-tinta p-3">
            {STREAK_BONUS.map((row) => (
              <div
                key={row.labelKey}
                className="flex flex-col items-center gap-2 text-center"
              >
                <div
                  className={`flex h-14 w-14 items-center justify-center border ${
                    row.peak ? "border-oro-viejo" : "border-tinta-2/50"
                  }`}
                >
                  <AchievementIcon name={row.icon} size="h-7 w-7" color={row.iconColor} />
                </div>
                <span className="pm-label !text-[9px]">{t(row.labelKey)}</span>
                <span className={`font-courier text-xl font-bold leading-none tabular-nums ${row.peak ? "text-oro-viejo" : "text-tinta"}`}>
                  {row.bonus}
                </span>
              </div>
            ))}
          </div>

          <p className="pm-body mt-3 text-xs">{t("scoring.bonusFootnote")}</p>
        </section>
    </ModalShell>
  );
}
