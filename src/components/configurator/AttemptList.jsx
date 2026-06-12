// src/components/configurator/AttemptList.jsx
// Intentos como filas de chips (marca / modelo / año). Mapea el feedback REAL del
// servidor (status correct/partial/wrong + dirección de año) al lenguaje de tonos
// del diseño: good (acierto) / near (mismo país) / off (fallo, rojo).
//   · marca:  correct→good+✓ · partial (misma nacionalidad)→near+bandera · wrong→off+✕
//   · modelo: correct→good+✓ · wrong→off+✕
//   · año:    correct→good+✓ (±tol) · wrong→off(rojo) + flecha ↑/↓ + MÁS NUEVO/ANTIGUO
// Doble codificación color+icono (accesible). El nombre va a UNA línea con
// auto-ajuste (useFitText): los nombres largos encogen en vez de partir en dos.
// Incluye la fila "pendiente" (shimmer neutro) y el flip-reveal por celda.

import { useT } from "../../i18n";
import { flagImagePath } from "../../data/countries";
import { Icon, I } from "./icons";
import { useFitText } from "../../hooks/useFitText";

// Stagger del flip por celda (efecto "carta volteándose").
const FLIP_STAGGER_MS = 130;

// Icono de estado para marca/modelo: ✓ acierto, ✕ fallo. (partial usa bandera,
// no icono; por eso devuelve null en cualquier otro status.)
function statusMark(status) {
  if (status === "correct") return <Icon d={I.check} size={14} />;
  if (status === "wrong") return <Icon d={I.x} size={13} />;
  return null;
}

function Chip({ tone, pending, children, sub, flag, mark, srStatus, fitKey, flip, delay }) {
  // Auto-ajuste del nombre a una sola línea: el ref va al span de texto y el hook
  // lo encoge solo si no cabe (lee el tamaño base del CSS).
  const textRef = useFitText(fitKey);
  return (
    <div
      className={"cdd-chip " + (pending ? "is-pending" : "tone-" + tone) + (flip ? " flip" : "")}
      style={flip ? { animationDelay: delay } : undefined}
    >
      <span className="cdd-chip-main">
        <span className="cdd-chip-text" ref={textRef}>{children}</span>
        {flag && <img className="cdd-flag" src={flag} alt="" draggable={false} />}
        {mark && <span className="cdd-chip-mark">{mark}</span>}
        {/* Estado para lectores de pantalla: el valor visible ya se lee; aquí solo
            añadimos la palabra de estado cuando no hay subtexto que la dé. */}
        {srStatus && <span className="sr-only">{srStatus}</span>}
      </span>
      {sub && <span className="cdd-chip-sub">{sub}</span>}
    </div>
  );
}

// Exportada: el Configurator la reusa para la "fila viva" del último intento
// dentro del fold (feedback visible sin scroll).
export function AttemptRow({ g, index, tolerance, pending, fresh }) {
  const { t } = useT();
  // Delay del flip por celda cuando la fila es la recién revelada.
  const d = (i) => (fresh ? i * FLIP_STAGGER_MS + "ms" : undefined);

  if (pending) {
    return (
      <div className="cdd-attempt">
        <div className="cdd-attempt-no">{String(index + 1).padStart(2, "0")}</div>
        <div className="cdd-attempt-chips">
          <Chip pending fitKey={g.marca?.val}>{g.marca?.val || "—"}</Chip>
          <Chip pending fitKey={g.modelo?.val}>{g.modelo?.val || "—"}</Chip>
          <Chip pending fitKey={String(g.anio?.val ?? "")}>{g.anio?.val || "—"}</Chip>
        </div>
      </div>
    );
  }

  // marca
  const mSt = g.marca?.status;
  const marcaTone = mSt === "correct" ? "good" : mSt === "partial" ? "near" : "off";
  const marcaFlag = mSt === "partial" && g.marca?.pais ? flagImagePath(g.marca.pais) : null;
  const marcaSub = mSt === "partial" ? t("cdd.sameCountry") : null;
  // partial → bandera (no icono). correct → ✓, wrong → ✕.
  const marcaMark = mSt === "partial" ? null : statusMark(mSt);
  const marcaSr = mSt === "correct" ? t("cdd.srCorrect") : mSt === "wrong" ? t("cdd.srWrong") : null;

  // modelo — binario: o aciertas o fallas.
  const moSt = g.modelo?.status;
  const modeloTone = moSt === "correct" ? "good" : "off";
  const modeloMark = statusMark(moSt);
  const modeloSr = moSt === "correct" ? t("cdd.srCorrect") : t("cdd.srWrong");

  // año
  const aSt = g.anio?.status;
  let anioTone = "off", anioSub = null, anioMark = null, anioSr = null;
  if (aSt === "correct") {
    anioTone = "good";
    anioSub = "±" + tolerance;
    anioMark = <Icon d={I.check} size={14} />;
    anioSr = t("cdd.srCorrect");
  } else {
    const dir = g.anio?.direction; // 'up' = el real es mayor (más nuevo)
    anioSub = dir === "up" ? t("cdd.yearNewer") : dir === "down" ? t("cdd.yearOlder") : null;
    anioMark = dir ? <Icon d={dir === "up" ? I.arrowU : I.arrowD} size={14} /> : null;
    // El subtexto (MÁS NUEVO/ANTIGUO) ya lo lee el lector de pantalla; no lo
    // duplicamos en un sr-only aparte.
  }

  return (
    <div className="cdd-attempt">
      <div className="cdd-attempt-no">{String(index + 1).padStart(2, "0")}</div>
      <div className="cdd-attempt-chips">
        <Chip tone={marcaTone} sub={marcaSub} flag={marcaFlag} mark={marcaMark} srStatus={marcaSr} fitKey={g.marca?.val} flip={fresh} delay={d(0)}>{g.marca?.val}</Chip>
        <Chip tone={modeloTone} mark={modeloMark} srStatus={modeloSr} fitKey={g.modelo?.val} flip={fresh} delay={d(1)}>{g.modelo?.val}</Chip>
        <Chip tone={anioTone} sub={anioSub} mark={anioMark} srStatus={anioSr} fitKey={String(g.anio?.val ?? "")} flip={fresh} delay={d(2)}>{g.anio?.val}</Chip>
      </div>
    </div>
  );
}

export default function AttemptList({ guesses = [], pendingGuess = null, justRevealedIndex = -1, tolerance = 2 }) {
  if (!guesses.length && !pendingGuess) return null;
  // Más RECIENTE primero: el historial vive bajo el formulario, así el intento
  // recién hecho (o el pendiente) queda pegado al botón. Conservamos el número
  // real de intento (i+1). El recién validado (justRevealedIndex) hace flip-reveal.
  return (
    <div className="cdd-attempts">
      {pendingGuess && (
        <AttemptRow key="pending" g={pendingGuess} index={guesses.length} tolerance={tolerance} pending />
      )}
      {guesses
        .map((g, i) => ({ g, i }))
        .reverse()
        .map(({ g, i }) => (
          <AttemptRow key={i} g={g} index={i} tolerance={tolerance} fresh={i === justRevealedIndex} />
        ))}
    </div>
  );
}
