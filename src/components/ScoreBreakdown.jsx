import { useEffect, useState } from "react";

// Animación count-up con ease-out cubic. Reactiva ante cambios de target.
function useCountUp(target, duration = 850) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!target || target <= 0) {
      setValue(target || 0);
      return;
    }

    let raf;
    const start = performance.now();

    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

export default function ScoreBreakdown({ score, won }) {
  const totalCount = useCountUp(score?.totalPoints || 0);

  if (!score) return null;

  const lines = [];
  if (won) {
    if (score.basePoints > 0) {
      lines.push({ label: "Base", value: score.basePoints });
    }
    if (score.streakBonus > 0) {
      lines.push({ label: "Bonus racha 🔥", value: score.streakBonus });
    }
  }

  return (
    <div className="my-4 rounded-xl border border-accent/25 bg-accent/[0.05] p-4 text-left">
      {lines.length > 0 && (
        <>
          <div className="space-y-1.5 text-sm">
            {lines.map((line, i) => (
              <div
                key={line.label}
                className="flex items-center justify-between text-white/85 animate-slide-up"
                style={{
                  animationDelay: `${i * 140}ms`,
                  animationFillMode: "both",
                }}
              >
                <span>{line.label}</span>
                <span className="font-display tabular-nums text-accent">
                  +{line.value}
                </span>
              </div>
            ))}
          </div>
          <div className="my-3 h-px bg-accent/20" />
        </>
      )}

      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-[0.22em] text-muted">
          {won ? "Tu puntuación" : "Racha rota"}
        </span>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-4xl tabular-nums text-accent leading-none">
            {totalCount}
          </span>
          <span className="text-[11px] uppercase tracking-widest text-muted">
            pts
          </span>
        </div>
      </div>

      {score.persisted && score.currentStreak !== null && (
        <div className="mt-3 flex justify-between gap-2 text-[11px] uppercase tracking-widest text-muted">
          <span>
            Racha:{" "}
            <span className="text-white tabular-nums">
              {score.currentStreak}
            </span>
          </span>
          {typeof score.totalScore === "number" && (
            <span>
              Total:{" "}
              <span className="text-white tabular-nums">{score.totalScore}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
