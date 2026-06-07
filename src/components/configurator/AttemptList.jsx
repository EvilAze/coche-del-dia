// src/components/configurator/AttemptList.jsx
// Intentos como filas de chips (marca / modelo / año). Mapea el feedback REAL
// del servidor (status correct/partial/wrong + dirección de año) al lenguaje de
// tonos del diseño: good (acierto sólido), near (cerca), off (fallo).
//   · marca: correct→good · partial (misma nacionalidad)→near + bandera · wrong→off
//   · modelo: correct→good · (marca correcta)→near · wrong→off
//   · año: correct→good (±tol) · wrong→off + flecha ↑/↓ + MÁS NUEVO/ANTIGUO
// Incluye la fila "pendiente" (esperando al servidor) con shimmer neutro, y el
// flip-reveal secuencial (marca→modelo→año) en el intento recién validado.

import { useT } from "../../i18n";
import { flagImagePath } from "../../data/countries";
import { Icon, I } from "./icons";

// Stagger del flip por celda (efecto "carta volteándose").
const FLIP_STAGGER_MS = 130;

function Chip({ tone, pending, children, sub, flag, flip, delay }) {
  return (
    <div
      className={"cdd-chip " + (pending ? "is-pending" : "tone-" + tone) + (flip ? " flip" : "")}
      style={flip ? { animationDelay: delay } : undefined}
    >
      <span className="cdd-chip-main">
        {children}
        {flag && <img className="cdd-flag" src={flag} alt="" draggable={false} />}
      </span>
      {sub && <span className="cdd-chip-sub">{sub}</span>}
    </div>
  );
}

function AttemptRow({ g, index, tolerance, pending, fresh }) {
  const { t } = useT();
  // Delay del flip por celda cuando la fila es la recién revelada.
  const d = (i) => (fresh ? i * FLIP_STAGGER_MS + "ms" : undefined);

  if (pending) {
    return (
      <div className="cdd-attempt">
        <div className="cdd-attempt-no">{String(index + 1).padStart(2, "0")}</div>
        <div className="cdd-attempt-chips">
          <Chip pending>{g.marca?.val || "—"}</Chip>
          <Chip pending>{g.modelo?.val || "—"}</Chip>
          <Chip pending>{g.anio?.val || "—"}</Chip>
        </div>
      </div>
    );
  }

  // marca
  const mSt = g.marca?.status;
  const marcaTone = mSt === "correct" ? "good" : mSt === "partial" ? "near" : "off";
  const marcaFlag = mSt === "partial" && g.marca?.pais ? flagImagePath(g.marca.pais) : null;
  const marcaSub = mSt === "partial" ? t("cdd.sameCountry") : null;

  // modelo
  const modeloTone = g.modelo?.status === "correct" ? "good" : mSt === "correct" ? "near" : "off";

  // año
  const aSt = g.anio?.status;
  let anioTone = "off", anioSub = null, anioIcon = null;
  if (aSt === "correct") { anioTone = "good"; anioSub = "±" + tolerance; }
  else {
    anioIcon = g.anio?.direction; // 'up' = el real es mayor (más nuevo)
    anioSub = anioIcon === "up" ? t("cdd.yearNewer") : anioIcon === "down" ? t("cdd.yearOlder") : null;
  }

  return (
    <div className="cdd-attempt">
      <div className="cdd-attempt-no">{String(index + 1).padStart(2, "0")}</div>
      <div className="cdd-attempt-chips">
        <Chip tone={marcaTone} sub={marcaSub} flag={marcaFlag} flip={fresh} delay={d(0)}>{g.marca?.val}</Chip>
        <Chip tone={modeloTone} flip={fresh} delay={d(1)}>{g.modelo?.val}</Chip>
        <Chip tone={anioTone} sub={anioSub} flip={fresh} delay={d(2)}>
          {g.anio?.val}
          {anioIcon && <Icon d={anioIcon === "up" ? I.arrowU : I.arrowD} size={14} />}
        </Chip>
      </div>
    </div>
  );
}

export default function AttemptList({ guesses = [], pendingGuess = null, justRevealedIndex = -1, tolerance = 2 }) {
  if (!guesses.length && !pendingGuess) return null;
  // Más RECIENTE primero: el historial vive DEBAJO del formulario, así que el
  // intento recién hecho (o el pendiente) queda pegado al botón → feedback
  // inmediato sin scroll. Conservamos el número real de intento (i+1). El intento
  // recién validado (justRevealedIndex) hace el flip-reveal por celda.
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
