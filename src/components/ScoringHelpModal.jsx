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

  // "Escalera de calor": tres niveles de racha que escalan en intensidad.
  // Llamas línea-arte (no emoji — coherencia con Logros y sin el bug de
  // Windows donde 🔥 sale gris). El calor sube de izquierda a derecha vía
  // icono distinto + color + glow del medallón.
  const STREAK_BONUS = [
    {
      labelKey: "scoring.streakLabel2",
      icon: "spark",
      bonus: "+1",
      iconColor: "text-accent/55",
      ring: "border-accent/20",
      glow: "0 0 12px rgba(232,200,122,0.10)",
    },
    {
      labelKey: "scoring.streakLabel3",
      icon: "spark_double",
      bonus: "+2",
      iconColor: "text-accent/80",
      ring: "border-accent/40",
      glow: "0 0 16px rgba(232,200,122,0.20)",
    },
    {
      labelKey: "scoring.streakLabel4plus",
      icon: "blaze",
      bonus: "+3",
      iconColor: "text-accent",
      ring: "border-accent/70",
      glow: "0 0 24px rgba(232,200,122,0.34)",
      peak: true,
    },
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

          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent px-3 pb-4 pt-5">
            {/* Hairline dorada superior: mismo detalle premium que StatCard. */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />

            <div className="relative">
              {/* Raíl de calor: se enciende de tenue (izq) a intenso (der),
                  pasando por el centro de los tres medallones. El fondo sólido
                  de cada medallón lo enmascara → "brasas en un alambre". */}
              <div className="pointer-events-none absolute left-[17%] right-[17%] top-7 h-px bg-gradient-to-r from-accent/15 via-accent/45 to-accent/90" />

              <div className="grid grid-cols-3 gap-2">
                {STREAK_BONUS.map((row) => (
                  <div
                    key={row.labelKey}
                    className="relative flex flex-col items-center gap-2 text-center"
                  >
                    <div className="relative">
                      {/* Halo pulsante solo en el nivel cúspide (Racha 4+). */}
                      {row.peak && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 rounded-full motion-safe:animate-pulse"
                          style={{ boxShadow: "0 0 22px rgba(232,200,122,0.45)" }}
                        />
                      )}
                      <div
                        className={`relative flex h-14 w-14 items-center justify-center rounded-full border ${row.ring} bg-bg-primary`}
                        style={{ boxShadow: row.glow }}
                      >
                        <AchievementIcon
                          name={row.icon}
                          size="h-7 w-7"
                          color={row.iconColor}
                        />
                      </div>
                    </div>

                    <span className="text-[10px] uppercase tracking-[0.18em] text-muted">
                      {t(row.labelKey)}
                    </span>
                    <span className="font-display text-2xl leading-none tabular-nums text-accent">
                      {row.bonus}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="mt-3 text-xs text-muted">
            {t("scoring.bonusFootnote")}
          </p>
        </section>
    </ModalShell>
  );
}
