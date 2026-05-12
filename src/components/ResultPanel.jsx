// src/components/ResultPanel.jsx
import Confetti from "./Confetti";
import ScoreBreakdown from "./ScoreBreakdown";
import { useToast } from "./Toast";
import { useCountdown } from "../hooks/useCountdown";

export default function ResultPanel({
  status,
  car,
  attempts,
  maxAttempts,
  shareText,
  score,
  user,
  onOpenLogin,
}) {
  const won = status === "won";
  const carDescription = car?.description?.trim();
  const toast = useToast();
  const { formatted: countdown } = useCountdown();

  async function handleShare() {
    try {
      if (navigator.share) {
        await navigator.share({ text: shareText });
        return;
      }
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareText);
        toast.push("Resultado copiado al portapapeles", { type: "success" });
        return;
      }
      toast.push("No se pudo compartir desde este navegador", { type: "error" });
    } catch (err) {
      // El usuario canceló el share nativo: no es un error real.
      if (err?.name === "AbortError") return;
      toast.push("No se pudo compartir", { type: "error" });
    }
  }

  return (
    <div className="rounded-xl border border-border bg-bg-tertiary p-6 text-center animate-fade-in">
      <Confetti active={won} />

      {won ? (
        <>
          <div className="font-display text-3xl tracking-widest text-green-400 mb-1">
            ¡ACERTASTE!
          </div>
          <div className="text-2xl mb-3">🎉</div>
        </>
      ) : (
        <>
          <div className="font-display text-3xl tracking-widest text-red-400 mb-1">
            SIN SUERTE
          </div>
          <div className="text-2xl mb-3">😔</div>
        </>
      )}

      <p className="text-muted text-sm mb-1">Era el</p>
      <p className="text-white font-medium text-base mb-1">
        {car.marca} {car.modelo}
      </p>
      <p className="text-accent font-display text-xl tracking-wider mb-2">
        {car.anio}
      </p>

      {won && (
        <p className="text-muted text-xs tracking-wider uppercase mb-3">
          Conseguido en {attempts} intento{attempts !== 1 ? "s" : ""}
        </p>
      )}

      <ScoreBreakdown score={score} won={won} />

      {carDescription && (
        <p className="text-muted text-sm leading-relaxed mb-4 text-left">
          {carDescription}
        </p>
      )}

      <div className="mb-4 rounded-lg border border-border bg-bg-secondary/60 p-3">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted">
          Próximo coche en
        </p>
        <p className="mt-1 font-display text-2xl tabular-nums tracking-[0.18em] text-white">
          {countdown}
        </p>
      </div>

      <div className="bg-bg-secondary rounded-lg p-3 mb-4 font-mono text-sm whitespace-pre-wrap text-left text-muted leading-relaxed">
        {shareText}
      </div>

      <button
        onClick={handleShare}
        className="
          border border-accent text-accent rounded-lg px-7 py-2.5
          text-xs tracking-widest uppercase font-body
          transition-colors hover:bg-accent/10 active:scale-[0.97]
        "
      >
        Compartir resultado
      </button>

      {!user && (
        <div className="mt-5 rounded-xl border border-accent/30 bg-gradient-to-br from-accent/15 via-accent/5 to-transparent p-4 text-left">
          <p className="font-display text-sm uppercase tracking-[0.14em] text-accent">
            🔥 Menuda racha
          </p>
          <p className="mt-2 text-sm leading-relaxed text-white/90">
            No pierdas tus estadisticas. Registrate para guardar tus victorias y competir en
            el ranking.
          </p>
          <button
            type="button"
            onClick={onOpenLogin}
            className="
              mt-4 w-full rounded-lg bg-accent px-4 py-2.5
              text-xs font-semibold uppercase tracking-[0.12em] text-black
              transition hover:brightness-110 active:scale-[0.98]
            "
          >
            Guardar mi progreso
          </button>
        </div>
      )}
    </div>
  );
}
