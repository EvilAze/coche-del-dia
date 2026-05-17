import { useEscape } from "../hooks/useEscape";
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

const STREAK_BONUS = [
  { label: "Racha 2", fires: "🔥", bonus: "+1" },
  { label: "Racha 3", fires: "🔥🔥", bonus: "+2" },
  { label: "Racha 4+", fires: "🔥🔥🔥", bonus: "+3" },
];

export default function ScoringHelpModal({ open, onClose }) {
  useEscape(open, onClose);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      backdropClassName="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
      panelClassName="w-full max-w-md rounded-2xl border border-white/10 bg-[#101014] p-5 shadow-2xl"
    >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-accent">
              Cómo se puntúa
            </p>
            <h2 className="font-display text-3xl tracking-widest text-white">
              Sistema
            </h2>
          </div>

          <CloseButton onClick={onClose} />
        </div>

        <section className="mb-5">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
            Puntos base
          </h3>
          <p className="mb-3 text-sm text-white/70">
            Cuantos menos intentos necesites, más puntos consigues.
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
                  Intento{" "}
                  <span className="font-display text-base text-white">
                    {row.attempt}
                  </span>
                </span>
                <span className="font-display tabular-nums text-lg text-accent">
                  {row.points} pts
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
            Bonus de racha
          </h3>
          <p className="mb-3 text-sm text-white/70">
            Acierta cada día sin fallar para sumar puntos extra.
          </p>

          <div className="grid grid-cols-3 gap-2">
            {STREAK_BONUS.map((row) => (
              <div
                key={row.label}
                className="
                  flex flex-col items-center justify-center gap-1
                  rounded-xl border border-accent/20 bg-accent/[0.06] px-2 py-3
                "
              >
                <span className="text-lg leading-none tracking-tighter">
                  {row.fires}
                </span>
                <span className="text-[10px] uppercase tracking-widest text-muted">
                  {row.label}
                </span>
                <span className="font-display text-xl tabular-nums text-accent leading-none">
                  {row.bonus}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs text-muted">
            El bonus se suma a los puntos base de cada día.
          </p>
        </section>
    </ModalShell>
  );
}
