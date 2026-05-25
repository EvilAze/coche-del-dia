// src/components/ResultPanel.jsx
import { useRef, useState } from "react";
import Confetti from "./Confetti";
import ScoreBreakdown from "./ScoreBreakdown";
import { useToast } from "./Toast";
import { useCountdown } from "../hooks/useCountdown";
import { useT, getCarDescription } from "../i18n";
import { haptic } from "../lib/haptics";

// Fallback de copia para contextos sin navigator.clipboard:
//   - Safari iOS < 13.4
//   - HTTP (no HTTPS) — Clipboard API exige secure context
//   - Algunos WebViews embebidos (Instagram, TikTok, etc.)
// document.execCommand("copy") está deprecated pero sigue funcionando en
// todos los browsers actuales y cubre exactamente esos casos.
function legacyCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    // Posicionamos fuera de la vista pero dentro del DOM — required para
    // que select() funcione. opacity:0 evita parpadeo si algún browser
    // lo pinta brevemente antes de la copia.
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.opacity = "0";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length); // iOS necesita range explícito
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

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

  // Estado efímero "Copiado": cambia el propio botón a un estado verde con
  // checkmark durante ~1.6 s tras un copy exitoso. Funciona como feedback
  // primario (el toast queda como confirmación redundante por accesibilidad).
  // El motivo: en móvil, el toast aparece donde está el pulgar — el dedo
  // tapa la confirmación. Cambiar el botón sí lo ve el usuario porque
  // acaba de pulsarlo y su mirada está fija ahí.
  const [justCopied, setJustCopied] = useState(false);
  const copyResetTimerRef = useRef(null);
  function flashCopied() {
    setJustCopied(true);
    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    copyResetTimerRef.current = setTimeout(() => setJustCopied(false), 1600);
  }

  async function handleShare() {
    haptic.impactLight();
    try {
      if (navigator.share) {
        // Share nativo: el OS muestra su propia hoja de compartir, no
        // necesitamos feedback porque el usuario ya recibe confirmación
        // visual del sistema. No flasheamos el botón aquí.
        await navigator.share({ text: shareText });
        return;
      }
      if (navigator.clipboard && window.isSecureContext !== false) {
        await navigator.clipboard.writeText(shareText);
        haptic.success();
        flashCopied();
        toast.push(t("result.shareCopied"), { type: "success" });
        return;
      }
      // Fallback legacy execCommand — cubre Safari iOS viejo, HTTP, WebViews.
      if (legacyCopy(shareText)) {
        haptic.success();
        flashCopied();
        toast.push(t("result.shareCopied"), { type: "success" });
        return;
      }
      toast.push(t("result.shareUnsupported"), { type: "error" });
    } catch (err) {
      // El usuario canceló el share nativo: no es un error real.
      if (err?.name === "AbortError") return;
      haptic.error();
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
            aria-live="polite"
            // disabled durante el flash para evitar dobles copias accidentales
            // (y para que active:scale no compita con la transición de color).
            disabled={justCopied}
            className={`
              rounded-lg px-7 py-2.5 text-xs tracking-widest uppercase font-body
              border transition-[color,background-color,border-color] duration-200
              ${justCopied
                ? "border-green-400/70 bg-green-400/10 text-green-400 cursor-default"
                : "border-accent text-accent hover:bg-accent/10 active:scale-[0.97]"}
            `}
          >
            {justCopied ? `✓ ${t("result.shareCopiedShort")}` : t("result.share")}
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
