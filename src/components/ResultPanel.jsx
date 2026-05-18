// src/components/ResultPanel.jsx
import Confetti from "./Confetti";
import ScoreBreakdown from "./ScoreBreakdown";
import { useToast } from "./Toast";
import { useCountdown } from "../hooks/useCountdown";
import { useT, getCarDescription } from "../i18n";

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
  const { t, tn } = useT();
  const won = status === "won";
  // Si el jugador no ha ganado, el servidor NO nos da marca/modelo/año por
  // diseño (anti-trampas vía DevTools). Renderizamos en consecuencia.
  const hasReveal = Boolean(car?.marca && car?.modelo && car?.anio);
  // useT() arriba garantiza re-render al cambiar locale; getCarDescription
  // lee el locale del módulo y elige description_en o description.
  const carDescription = getCarDescription(car)?.trim();
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
        toast.push(t("result.shareCopied"), { type: "success" });
        return;
      }
      toast.push(t("result.shareUnsupported"), { type: "error" });
    } catch (err) {
      // El usuario canceló el share nativo: no es un error real.
      if (err?.name === "AbortError") return;
      toast.push(t("result.shareError"), { type: "error" });
    }
  }

  return (
    <div className="rounded-xl border border-border bg-bg-tertiary p-6 text-center animate-fade-in">
      <Confetti active={won} />

      {won ? (
        <>
          <div className="font-display text-3xl tracking-widest text-green-400 mb-1">
            {t("result.wonTitle")}
          </div>
          <div className="text-2xl mb-3">🎉</div>
        </>
      ) : (
        <>
          <div className="font-display text-3xl tracking-widest text-red-400 mb-1">
            {t("result.lostTitle")}
          </div>
          <div className="text-2xl mb-3">😔</div>
        </>
      )}

      {hasReveal ? (
        <>
          <p className="text-muted text-sm mb-1">{t("result.wasThe")}</p>
          <p className="text-white font-medium text-base mb-1">
            {car.marca} {car.modelo}
          </p>
          <p className="text-accent font-display text-xl tracking-wider mb-2">
            {car.anio}
          </p>
        </>
      ) : (
        // Anónimo que ha perdido: el coche queda oculto aquí; la imagen de
        // arriba ya muestra el overlay con el CTA de login, así que no
        // duplicamos la llamada a la acción.
        <p className="text-muted text-sm mb-3">
          {t("result.lockedAnswer")}
        </p>
      )}

      {won && (
        <p className="text-muted text-xs tracking-wider uppercase mb-3">
          {tn("result.achievedIn", attempts)}
        </p>
      )}

      <ScoreBreakdown score={score} won={won} />

      {carDescription && (
        <div className="mb-4 rounded-lg border border-border/60 bg-bg-secondary/50 px-4 py-3 text-left">
          <p className="mb-1 text-[10px] uppercase tracking-[0.22em] text-accent">
            {t("result.spec")}
          </p>
          <p className="text-sm leading-relaxed text-white/90">
            {carDescription}
          </p>
        </div>
      )}

      <div className="mb-4 rounded-lg border border-border bg-bg-secondary/60 p-3">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted">
          {t("result.nextCar")}
        </p>
        <p className="mt-1 font-display text-2xl tabular-nums tracking-[0.18em] text-white">
          {countdown}
        </p>
      </div>

      {shareText && (
        <>
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
            {t("result.share")}
          </button>
        </>
      )}

      {!user && won && (
        <div className="mt-5 rounded-xl border border-accent/30 bg-gradient-to-br from-accent/15 via-accent/5 to-transparent p-4 text-left">
          <p className="font-display text-sm uppercase tracking-[0.14em] text-accent">
            {t("result.saveProgressTitle")}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-white/90">
            {t("result.saveProgressBody")}
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
            {t("result.saveProgressCta")}
          </button>
        </div>
      )}
    </div>
  );
}
