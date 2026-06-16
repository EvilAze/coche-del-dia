// src/components/configurator/AttemptList.jsx
// Filas de intento calcadas del guess-row.tsx de v0: rejilla de 3 celdas
// (marca / modelo / año), cada celda UNA línea `valor … icono`. Mapea el feedback
// REAL del servidor (correct / partial / wrong + dirección de año) al color v0:
//   · correct → menta (bg-mint/15) + ✓     · partial (mismo país) → ámbar + bandera
//   · wrong   → rojo (bg-destructive/10) + ✕ · año wrong → rojo + flecha ↑/↓
// Doble codificación color+icono (accesible). Fila "pendiente" = pulse neutro;
// la recién validada hace flip-reveal por celda.

import { useT } from "../../i18n";
import { flagImagePath } from "../../data/countries";
import { Icon, I } from "./icons";

// Stagger del flip por celda (efecto "carta volteándose").
const FLIP_STAGGER_MS = 130;

function Cell({ tone, pending, value, mark, markTone, flag, srStatus, flip, delay }) {
  const toneClass = pending
    ? "bg-bg-tertiary text-muted-foreground animate-pulse"
    : tone === "good"
      ? "bg-mint/15 text-foreground"
      : tone === "near"
        ? "bg-amber-400/10 text-foreground"
        : "bg-destructive/10 text-foreground";
  return (
    <div
      className={
        "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm " +
        toneClass +
        (flip ? " animate-flip-reveal" : "")
      }
      style={flip ? { animationDelay: delay } : undefined}
    >
      <span className="truncate">{value || "—"}</span>
      {/* Estado para lectores de pantalla (los ✓/✕/flechas son SVG decorativos). */}
      {srStatus && <span className="sr-only">{srStatus}</span>}
      {(flag || mark) && (
        <span className={"flex shrink-0 items-center gap-1 " + (markTone || "")}>
          {flag && <img className="h-3 w-[18px] rounded-[2px] object-cover" src={flag} alt="" draggable={false} />}
          {mark}
        </span>
      )}
    </div>
  );
}

// Exportada: el Configurator la reusa para la "fila viva" del último intento.
export function AttemptRow({ g, pending, fresh }) {
  const { t } = useT();
  const d = (i) => (fresh ? i * FLIP_STAGGER_MS + "ms" : undefined);

  if (pending) {
    return (
      <div className="grid grid-cols-3 gap-2">
        <Cell pending value={g.marca?.val} />
        <Cell pending value={g.modelo?.val} />
        <Cell pending value={g.anio?.val} />
      </div>
    );
  }

  // marca: correct → ✓ menta · partial (mismo país) → bandera ámbar · wrong → ✕ rojo
  const mSt = g.marca?.status;
  const marcaTone = mSt === "correct" ? "good" : mSt === "partial" ? "near" : "off";
  const marcaFlag = mSt === "partial" && g.marca?.pais ? flagImagePath(g.marca.pais) : null;
  const marcaMark = mSt === "correct" ? <Icon d={I.check} size={14} /> : mSt === "wrong" ? <Icon d={I.x} size={13} /> : null;
  const marcaMarkTone = mSt === "correct" ? "text-mint" : "text-destructive/80";
  const marcaSr = mSt === "correct" ? t("cdd.srCorrect") : mSt === "partial" ? t("cdd.sameCountry") : t("cdd.srWrong");

  // modelo — binario.
  const moSt = g.modelo?.status;
  const modeloTone = moSt === "correct" ? "good" : "off";
  const modeloMark = moSt === "correct" ? <Icon d={I.check} size={14} /> : <Icon d={I.x} size={13} />;
  const modeloMarkTone = moSt === "correct" ? "text-mint" : "text-destructive/80";
  const modeloSr = moSt === "correct" ? t("cdd.srCorrect") : t("cdd.srWrong");

  // año — correct → ✓; wrong → flecha de dirección (↑ el real es más nuevo).
  const aSt = g.anio?.status;
  let anioTone, anioMark, anioMarkTone, anioSr;
  if (aSt === "correct") {
    anioTone = "good";
    anioMark = <Icon d={I.check} size={14} />;
    anioMarkTone = "text-mint";
    anioSr = t("cdd.srCorrect");
  } else {
    anioTone = "off";
    const dir = g.anio?.direction;
    anioMark = dir ? <Icon d={dir === "up" ? I.arrowU : I.arrowD} size={14} /> : <Icon d={I.x} size={13} />;
    anioMarkTone = "text-destructive/80";
    anioSr = dir === "up" ? t("cdd.yearNewer") : dir === "down" ? t("cdd.yearOlder") : t("cdd.srWrong");
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      <Cell tone={marcaTone} value={g.marca?.val} mark={marcaMark} markTone={marcaMarkTone} flag={marcaFlag} srStatus={marcaSr} flip={fresh} delay={d(0)} />
      <Cell tone={modeloTone} value={g.modelo?.val} mark={modeloMark} markTone={modeloMarkTone} srStatus={modeloSr} flip={fresh} delay={d(1)} />
      <Cell tone={anioTone} value={g.anio?.val} mark={anioMark} markTone={anioMarkTone} srStatus={anioSr} flip={fresh} delay={d(2)} />
    </div>
  );
}

export default function AttemptList({ guesses = [], pendingGuess = null, justRevealedIndex = -1 }) {
  const { t } = useT();
  if (!guesses.length && !pendingGuess) return null;
  // Cabecera de columnas + filas (más reciente primero), calcado del guess-history
  // de v0. El flip-reveal lo dispara el intento recién validado (justRevealedIndex).
  return (
    <section aria-label={t("cdd.lastAttempt")} className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
        <span>{t("cdd.labelMarca")}</span>
        <span>{t("cdd.labelModelo")}</span>
        <span>{t("cdd.labelAnio")}</span>
      </div>
      <div className="flex flex-col gap-2">
        {pendingGuess && <AttemptRow key="pending" g={pendingGuess} pending />}
        {guesses
          .map((g, i) => ({ g, i }))
          .reverse()
          .map(({ g, i }) => (
            <AttemptRow key={i} g={g} fresh={i === justRevealedIndex} />
          ))}
      </div>
    </section>
  );
}
