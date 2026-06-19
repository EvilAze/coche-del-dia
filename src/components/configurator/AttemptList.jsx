// src/components/configurator/AttemptList.jsx
// Filas de intento: rejilla de 3 celdas (marca / modelo / año). Combina el COLOR
// plano del v0 (menta / ámbar / rojo) con la ANATOMÍA del diseño anterior — celda
// en 2 zonas APILADAS: fila 1 = NOMBRE (useFitText lo encoge a una línea), fila 2 =
// META de estado DEBAJO (bandera + "mismo país" en marca, ✓/✕, flecha ↑/↓ del año).
// Feedback REAL del servidor (correct / partial / wrong + dirección). Doble
// codificación color+icono (accesible). Fila pendiente = pulse; recién validada =
// flip-reveal por celda.

import { useT } from "../../i18n";
import { flagImagePath } from "../../data/countries";
import { Icon, I } from "./icons";
import { useFitText } from "../../hooks/useFitText";

// Stagger del flip por celda (efecto "carta volteándose").
const FLIP_STAGGER_MS = 130;

function Cell({ tone, pending, value, mark, markTone, flag, sub, srStatus, flip, delay, fitKey }) {
  // Auto-ajuste del nombre a una línea (el nombre ocupa toda la fila 1, así que el
  // hook dispone del ancho completo de la celda).
  const textRef = useFitText(fitKey);
  const toneClass = pending
    ? "bg-bg-tertiary text-muted-foreground animate-pulse"
    : tone === "good"
      ? "bg-mint/15 text-foreground"
      : tone === "near"
        ? "bg-amber-400/10 text-foreground"
        : "bg-destructive/10 text-foreground";
  const hasMeta = flag || mark || sub;
  return (
    <div
      className={
        "flex min-h-[54px] flex-col justify-center gap-1 rounded-lg px-3 py-2 " +
        toneClass +
        (flip ? " animate-flip-reveal" : "")
      }
      // backfaceVisibility:hidden mantiene el giro 3D limpio (sin destellos de
      // la cara trasera al cruzar los 90deg). animationDelay = stagger por celda.
      style={flip ? { animationDelay: delay, backfaceVisibility: "hidden" } : undefined}
    >
      {/* Fila 1: nombre a ancho completo (una línea, lo encoge useFitText). */}
      <span ref={textRef} className="block w-full overflow-hidden whitespace-nowrap text-sm font-medium leading-tight">
        {value || "—"}
      </span>
      {/* Estado para lectores de pantalla (los ✓/✕/flechas son SVG decorativos). */}
      {srStatus && <span className="sr-only">{srStatus}</span>}
      {/* Fila 2: meta de estado DEBAJO del nombre. */}
      {hasMeta && (
        <span className={"flex min-h-[14px] items-center gap-1.5 " + (markTone || "text-muted-foreground")}>
          {flag && <img className="h-3 w-[18px] shrink-0 rounded-[2px] object-cover" src={flag} alt="" draggable={false} />}
          {mark}
          {sub && <span className="truncate font-mono text-[9px] uppercase tracking-wide opacity-90">{sub}</span>}
        </span>
      )}
    </div>
  );
}

// Exportada: el Configurator la reusa para la "fila viva" del último intento.
export function AttemptRow({ g, tolerance = 2, pending, fresh }) {
  const { t } = useT();
  const d = (i) => (fresh ? i * FLIP_STAGGER_MS + "ms" : undefined);

  if (pending) {
    return (
      <div className="grid grid-cols-3 gap-2">
        <Cell pending value={g.marca?.val} fitKey={g.marca?.val} />
        <Cell pending value={g.modelo?.val} fitKey={g.modelo?.val} />
        <Cell pending value={g.anio?.val} fitKey={String(g.anio?.val ?? "")} />
      </div>
    );
  }

  // marca: correct → ✓ menta · partial (mismo país) → bandera + "mismo país" ámbar · wrong → ✕ rojo
  const mSt = g.marca?.status;
  const marcaTone = mSt === "correct" ? "good" : mSt === "partial" ? "near" : "off";
  const marcaFlag = mSt === "partial" && g.marca?.pais ? flagImagePath(g.marca.pais) : null;
  const marcaSub = mSt === "partial" ? t("cdd.sameCountry") : null;
  const marcaMark = mSt === "correct" ? <Icon d={I.check} size={13} /> : mSt === "wrong" ? <Icon d={I.x} size={12} /> : null;
  const marcaMarkTone = mSt === "correct" ? "text-mint" : mSt === "partial" ? "text-amber-300" : "text-destructive/80";
  const marcaSr = mSt === "correct" ? t("cdd.srCorrect") : mSt === "partial" ? t("cdd.sameCountry") : t("cdd.srWrong");

  // modelo — binario.
  const moSt = g.modelo?.status;
  const modeloTone = moSt === "correct" ? "good" : "off";
  const modeloMark = moSt === "correct" ? <Icon d={I.check} size={13} /> : <Icon d={I.x} size={12} />;
  const modeloMarkTone = moSt === "correct" ? "text-mint" : "text-destructive/80";
  const modeloSr = moSt === "correct" ? t("cdd.srCorrect") : t("cdd.srWrong");

  // año — correct → ✓ + "±tol"; wrong → flecha ↑/↓ (↑ = el real es más nuevo).
  const aSt = g.anio?.status;
  let anioTone, anioMark, anioMarkTone, anioSub = null, anioSr;
  if (aSt === "correct") {
    anioTone = "good";
    anioMark = <Icon d={I.check} size={13} />;
    anioMarkTone = "text-mint";
    anioSub = "±" + tolerance;
    anioSr = t("cdd.srCorrect");
  } else {
    anioTone = "off";
    const dir = g.anio?.direction;
    anioMark = dir ? <Icon d={dir === "up" ? I.arrowU : I.arrowD} size={14} /> : <Icon d={I.x} size={12} />;
    anioMarkTone = "text-destructive/80";
    anioSr = dir === "up" ? t("cdd.yearNewer") : dir === "down" ? t("cdd.yearOlder") : t("cdd.srWrong");
  }

  return (
    // perspective en el contenedor para que el rotateX de las celdas sea un
    // giro 3D real ("carta volteándose") y no un aplastamiento vertical
    // ortográfico. Solo importa cuando fresh dispara el flip; en reposo no
    // afecta. Mismo valor (600px) que el GuessRow legacy, por coherencia.
    <div className="grid grid-cols-3 gap-2" style={fresh ? { perspective: "600px" } : undefined}>
      <Cell tone={marcaTone} value={g.marca?.val} fitKey={g.marca?.val} mark={marcaMark} markTone={marcaMarkTone} flag={marcaFlag} sub={marcaSub} srStatus={marcaSr} flip={fresh} delay={d(0)} />
      <Cell tone={modeloTone} value={g.modelo?.val} fitKey={g.modelo?.val} mark={modeloMark} markTone={modeloMarkTone} srStatus={modeloSr} flip={fresh} delay={d(1)} />
      <Cell tone={anioTone} value={g.anio?.val} fitKey={String(g.anio?.val ?? "")} mark={anioMark} markTone={anioMarkTone} sub={anioSub} srStatus={anioSr} flip={fresh} delay={d(2)} />
    </div>
  );
}

export default function AttemptList({ guesses = [], pendingGuess = null, justRevealedIndex = -1, tolerance = 2 }) {
  const { t } = useT();
  if (!guesses.length && !pendingGuess) return null;
  // Cabecera de columnas + filas (más reciente primero). El flip-reveal lo dispara
  // el intento recién validado (justRevealedIndex).
  return (
    <section aria-label={t("cdd.lastAttempt")} className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
        <span>{t("cdd.labelMarca")}</span>
        <span>{t("cdd.labelModelo")}</span>
        <span>{t("cdd.labelAnio")}</span>
      </div>
      <div className="flex flex-col gap-2">
        {pendingGuess && <AttemptRow key="pending" g={pendingGuess} tolerance={tolerance} pending />}
        {guesses
          .map((g, i) => ({ g, i }))
          .reverse()
          .map(({ g, i }) => (
            <AttemptRow key={i} g={g} tolerance={tolerance} fresh={i === justRevealedIndex} />
          ))}
      </div>
    </section>
  );
}
