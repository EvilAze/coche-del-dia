// src/components/ResultPanel.jsx
import { useEffect, useRef, useState } from "react";
import Confetti from "./Confetti";
import ScoreBreakdown from "./ScoreBreakdown";
import DailyStats from "./DailyStats";
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

// Mini-icono de llama: usamos el mismo SVG que en HeaderSandwich en lugar
// del emoji 🔥, que se renderiza con la paleta del SO y rompe la coherencia
// con la paleta dorada/accent del resto de la app. El share TEXT que se
// copia al portapapeles sigue llevando 🔥 (mejor reconocimiento en redes).
function FlameIcon({ className = "h-3 w-3" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

// Preview visual de lo que se va a compartir. Antes pintábamos shareText
// crudo en font-mono (parecía un bloque de código). Esto renderiza un
// grid binario (acierto→verde / resto→rojo) en forma de tiles que
// respetan la paleta del juego.
//
// NOTA (legacy): este panel ya NO es la UI principal del juego — el flujo
// vivo de compartir es configurator/EndScreen.jsx (su shareGrid usa el
// lenguaje binario ✅/❌ de buildShareText, useGame.js — mismo binarismo
// que estos tiles, así que el preview vuelve a ser fiel). Aquí solo lo usa
// Repesca, que pasa shareText="" → este bloque nunca se renderiza.
//
// Decisiones de diseño tras el primer pase:
//   - Paleta apagada (#1a2f1a / #2a1a1a + borde) en lugar de red-500/
//     green-500 vibrantes. Los tonos saturados chocaban con el resto
//     del "OEM+ dark premium" — el grid se sentía pegado de otra app.
//   - Tiles de 24px (h-6 w-6) con rounded-md. Más sustancia visual que
//     los 20px planos del primer pase, sin caer en lo chillón de Wordle.
//   - ✓ / ✕ glyphs DENTRO de cada tile, en el mismo verde/rojo que las
//     GuessRow. Refuerza la conexión visual con el juego y aporta
//     "textura" sin necesidad de gradientes barrocos.
//   - Inner highlight de 1 px arriba (`inset 0 1px 0 rgba(255,255,255,
//     0.06)`) — efecto "chip físico" sutil bajo la luz superior.
//   - Stagger reveal celda a celda al montar el panel, coreografiado
//     con la entrada del propio ResultPanel.
//   - Wordmark con micro-línea dorada por debajo, tipo "watermark".
function ShareGridPreview({ guesses, streak, shareText }) {
  if (!guesses || guesses.length === 0) return null;

  // Stagger: cada celda entra ~35 ms después de la anterior. Total para
  // un grid 5×3 = 15·35 = 525 ms. Bien dentro del rango "se siente vivo
  // sin hacerse esperar". Si el grid se monta cuando el confetti ya está
  // disparado, el ojo del usuario ya está apuntando aquí — la animación
  // refuerza el momento de victoria sin distraer.
  const REVEAL_BASE_MS = 80;     // delay inicial tras montar el panel
  const REVEAL_STAGGER_MS = 35;  // entre celdas

  // NOTA: este componente NO lleva ya su propio card chrome (border,
  // bg, rounded, mb, padding). Esos vienen del wrapper en ResultPanel
  // que también engloba el botón de Compartir — preview y acción son
  // una sola unidad visual.
  return (
    <div
      className="text-center"
      // El shareText completo va en aria-label para que un lector de
      // pantalla anuncie qué se va a copiar — los cuadrados no son
      // accesibles semánticamente por sí solos.
      role="img"
      aria-label={shareText}
    >
      {streak > 0 && (
        <div
          className="
            mb-3 inline-flex items-center gap-1 rounded-full
            border border-accent/30 bg-accent/10 px-2 py-0.5
            text-[10px] uppercase tracking-[0.18em] text-accent
          "
        >
          <FlameIcon /> <span className="tabular-nums">{streak}</span>
        </div>
      )}

      <div className="flex flex-col items-center gap-1.5">
        {guesses.map((g, i) => (
          <div key={i} className="flex gap-1.5">
            {[g.marca, g.modelo, g.anio].map((cell, j) => {
              // Binario: solo "correct" cuenta como verde; el resto cae a
              // rojo — mismo criterio que el ✅/❌ del shareText actual.
              const ok = cell?.status === "correct";
              const delayMs = REVEAL_BASE_MS + (i * 3 + j) * REVEAL_STAGGER_MS;
              return (
                <span
                  key={j}
                  aria-hidden="true"
                  className={`
                    inline-flex h-6 w-6 items-center justify-center
                    rounded-md border text-[11px] font-bold leading-none
                    animate-pop
                    ${ok
                      ? "bg-[#1a2f1a] border-[#2d5a2d] text-green-400/90"
                      : "bg-[#2a1a1a] border-[#5a2d2d] text-red-400/85"}
                  `}
                  style={{
                    animationDelay: `${delayMs}ms`,
                    animationFillMode: "both",
                    // Inner highlight superior: simula el reflejo que
                    // tendría un chip físico bajo iluminación cenital.
                    // Muy bajo en alpha (0.06) para que sea perceptible
                    // sólo al fijarse, no protagonista.
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.25)",
                  }}
                >
                  {ok ? "✓" : "✕"}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <p className="mt-4 text-[10px] tracking-[0.22em] text-muted/70">
        cochedeldia.com
      </p>
    </div>
  );
}

export default function ResultPanel({
  status,
  car,
  attempts,
  maxAttempts,
  shareText,
  guesses = [],
  streak = 0,
  score,
  user,
  onOpenLogin,
  revealReady = false,
  // "Hoy en el mundo" (DailyStats) solo tiene sentido en el juego diario: son
  // las stats del coche de HOY. En repesca (coche pasado, otras reglas) sería
  // engañoso, así que el caller lo desactiva.
  showDailyStats = true,
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

  // Scroll estratégico post-revelado. Secuencia pensada para el pico
  // emocional de ganar:
  //   1. La partida termina → este panel monta y la imagen recortada se
  //      sustituye por la foto COMPLETA (sin crop). Esa imagen tiene que
  //      descargarse: en red lenta o cold-start del proxy puede tardar.
  //   2. Esperamos al evento real de carga (revealReady, que enciende
  //      CarImage cuando la foto full ya está pintada) + el tiempo de la
  //      transición de aspect-ratio (~750 ms). Así el jugador SIEMPRE ve
  //      el coche entero antes de que la vista se mueva — nunca un scroll
  //      forzado sobre una imagen a medio cargar.
  //   3. Scroll suave que lleva el botón de Compartir al centro del
  //      viewport: título + puntuación arriba, CTA de compartir a un toque.
  //
  // Techo de seguridad: si la imagen nunca avisa (error de red sostenido,
  // watchdog del fallback agotado), a los 3.5 s scrolleamos igualmente para
  // no dejar al jugador atrapado arriba. El ref `didScrollRef` garantiza
  // que el scroll ocurre UNA sola vez, gane quien gane la carrera entre el
  // revelado real y el techo.
  const shareButtonRef = useRef(null);
  const didScrollRef = useRef(false);
  useEffect(() => {
    function doScroll() {
      if (didScrollRef.current) return;
      const el = shareButtonRef.current;
      if (!el) return;
      didScrollRef.current = true;
      const prefersReduced =
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      el.scrollIntoView({
        behavior: prefersReduced ? "auto" : "smooth",
        block: "center",
      });
    }

    const timers = [];
    // Camino normal: la foto full ya cargó → margen para la transición de
    // aspect-ratio → scroll.
    if (revealReady) {
      timers.push(setTimeout(doScroll, 800));
    }
    // Techo de seguridad, independiente del estado de carga.
    timers.push(setTimeout(doScroll, 3500));

    return () => timers.forEach(clearTimeout);
  }, [revealReady]);

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
        // En victoria el Confetti animado (línea 242) ya carga la
        // celebración — añadir un 🎉 estático debajo del título era doble
        // celebración y leía como asterisco triste. En derrota mantenemos
        // 😔 porque no hay particle animation y el emoji aporta la única
        // señal emocional.
        <div className="font-display text-3xl tracking-widest text-green-400 mb-3">
          {t("result.wonTitle")}
        </div>
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
          {/* Marca/modelo y año en una sola línea (items-baseline) en lugar
              de tres bloques apilados. Reduce la altura del bloque de
              revelado sin perder la jerarquía: el año mantiene su peso
              dorado display, el nombre su peso medio en blanco. */}
          <div className="mb-2 flex flex-wrap items-baseline justify-center gap-x-2 gap-y-0.5">
            <span className="text-white font-medium text-base">
              {car.marca} {car.modelo}
            </span>
            <span className="text-accent font-display text-xl tracking-wider">
              {car.anio}
            </span>
          </div>
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

      {/* Streak freeze: aviso AUTOEXPLICATIVO cuando un congelado ha salvado la
          racha. Solo ocurre al ganar tras faltar exactamente un día — el
          momento orgánico para contar el "por qué" (faltaste → se usó). El
          cuerpo explica la causa para que se entienda aunque sea la 1ª vez. */}
      {score?.freezeUsed && (
        <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-accent/30 bg-accent/[0.07] px-3 py-2.5 text-left">
          <svg
            viewBox="0 0 24 24"
            className="mt-0.5 h-4 w-4 shrink-0 text-accent"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3l7 2.6v5.2c0 4.5-3 7.6-7 9.2-4-1.6-7-4.7-7-9.2V5.6z" />
            <path d="M9 12l2 2 4-4.2" />
          </svg>
          <span className="flex flex-col">
            <span className="text-xs font-semibold text-accent">
              {t("result.streakSavedTitle")}
            </span>
            <span className="text-[11px] leading-snug text-muted">
              {t("result.streakSavedBody")}
            </span>
          </span>
        </div>
      )}

      {shareText && (
        // Card UNIFICADA: preview + acción son una sola unidad conceptual
        // ("esto es lo que vas a compartir" + "hazlo"). Antes vivían en
        // contenedores separados y eso rompía la conexión causa→efecto
        // — el usuario veía dos "cosas" en lugar de una.
        //
        // La línea dorada en gradiente actúa AL MISMO TIEMPO como sello
        // del wordmark y como divisor entre preview y CTA. Doble función
        // visual con un único elemento — patrón típico de share cards en
        // los daily puzzles de NYT, etc.
        //
        // Orden de la página: este bloque va ANTES de la cuenta atrás
        // ("próximo coche en...") porque captura al usuario en el pico
        // emocional del win. Meter info "para mañana" entre la victoria
        // y el botón de compartir bajaba el momentum del share.
        <div
          className="
            mb-4 rounded-xl border border-border/60 bg-bg-secondary/40
            px-4 pt-4 pb-4
          "
        >
          <ShareGridPreview
            guesses={guesses}
            streak={streak}
            shareText={shareText}
          />

          {/* Divisor + sello: gradient line full-width que separa "lo que
              vas a compartir" de "cómo compartirlo". Pegado debajo del
              wordmark "cochedeldia.com" para que actúe también como
              subrayado de marca. */}
          <span
            aria-hidden="true"
            className="
              mt-1 mb-3 block h-px w-full
              bg-gradient-to-r from-transparent via-accent/40 to-transparent
            "
          />

          <button
            ref={shareButtonRef}
            onClick={handleShare}
            aria-live="polite"
            // disabled durante el flash para evitar dobles copias accidentales
            // (y para que active:scale no compita con la transición de color).
            disabled={justCopied}
            // Estado idle: outlined dorado con wash interno sutil
            // (bg-accent/[0.06]) + halo exterior bajo (shadow accent/15)
            // + icono share a la izquierda. El conjunto eleva visibilidad
            // sin pasarse a "botón sólido" (lo que entraría en competencia
            // con el GUARDAR MI PROGRESO sólido de abajo cuando aparecen
            // los dos en anon-win). El halo cambia a más intenso en hover.
            className={`
              focus-ring
              group inline-flex w-full items-center justify-center gap-2
              rounded-lg border
              px-4 py-2.5 text-xs tracking-widest uppercase font-semibold font-body
              transition-[color,background-color,border-color,box-shadow,transform]
              duration-200
              ${justCopied
                ? "border-green-400/70 bg-green-400/10 text-green-400 cursor-default"
                : `border-accent text-accent
                   bg-accent/[0.06]
                   shadow-[0_0_24px_-6px_rgba(232,200,122,0.25)]
                   hover:bg-accent/15
                   hover:shadow-[0_0_28px_-4px_rgba(232,200,122,0.4)]
                   active:scale-[0.97]`}
            `}
          >
            {justCopied ? (
              <>✓ {t("result.shareCopiedShort")}</>
            ) : (
              <>
                {/* Icono share genérico (square + arrow) — universal,
                    funciona tanto si el OS abre share sheet nativo como
                    si copia al portapapeles. Stroke 2 para parear el
                    peso de la tipografía font-semibold. */}
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-y-0.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
                  <path d="M16 6l-4-4-4 4" />
                  <path d="M12 2v14" />
                </svg>
                {t("result.share")}
              </>
            )}
          </button>
        </div>
      )}

      {showDailyStats && <DailyStats attempts={attempts} won={won} />}

      {/* Ficha del coche (lore): movida aquí abajo, tras el share y las
          stats del día. Es contenido de recompensa/aprendizaje, no
          time-sensitive — no debe empujar el botón de compartir fuera de
          la primera pantalla. El jugador que quiere el dato lo encuentra;
          el que solo quiere compartir y salir, no lo tiene en medio. */}
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
