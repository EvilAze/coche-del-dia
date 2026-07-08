// src/components/configurator/AttemptList.jsx
// Clasificación «Prensa del motor»: cada intento es una FILA numerada (01…)
// con tres datos en Fraunces y veredictos como MARCAS DE CORRECTOR:
//   acierto → subrayado rojo firme + ✓ · cerca → subrayado rojo discontinuo
//   con apostilla en cursiva (bandera + "mismo país", "más nuevo ↑") ·
//   fallo → tachado en tinta.
// Fondos transparentes: la fila es tipografía + filete, no un chip. Feedback
// REAL del servidor (correct/partial/wrong + dirección), doble codificación
// marca+texto (accesible; el estado exacto va también en sr-only). Pendiente =
// "entintado" (pulso de opacidad); recién validada = estampado.

import { useT } from "../../i18n";
import { flagImagePath } from "../../data/countries";
import { Icon, I } from "./icons";
import { useFitText } from "../../hooks/useFitText";

// Stagger del estampado por celda: la cascada marca → modelo → año se lee
// con calma, como tres golpes de tampón.
const STAGGER_MS = 120;

function Dato({ estado, pending, value, apostilla, srStatus, fresh, delay, fitKey }) {
  // Auto-ajuste del nombre a una línea: el wrapper bloque da el ancho de la
  // celda al hook; la .palabra inline mantiene el subrayado/tachado AL ANCHO
  // DE LA PALABRA (es una marca de corrector, no un borde de caja).
  const textRef = useFitText(fitKey);
  return (
    <div
      className={
        "prensa-dato " +
        (pending ? "" : estado) +
        (fresh ? " prensa-estampada" : "")
      }
      style={fresh ? { animationDelay: delay } : undefined}
    >
      <span ref={textRef} className="linea-nombre">
        <span className="palabra">{value || "—"}</span>
        {!pending && estado === "bien" && <span className="marca-v" aria-hidden="true"> ✓</span>}
      </span>
      {srStatus && <span className="sr-only">{srStatus}</span>}
      {!pending && apostilla}
    </div>
  );
}

// Exportada: el Configurator la reusa para la "fila viva" del último intento.
// `num` es el ordinal 1-based del intento (para el 01… de la izquierda).
export function AttemptRow({ g, tolerance = 2, pending, fresh, num = null }) {
  const { t } = useT();
  const d = (i) => (fresh ? i * STAGGER_MS + "ms" : undefined);
  const numLabel = num ? String(num).padStart(2, "0") : "";

  if (pending) {
    return (
      <div className="prensa-fila prensa-fila-pendiente">
        <span className="num">{numLabel}</span>
        <Dato pending value={g.marca?.val} fitKey={g.marca?.val} />
        <Dato pending value={g.modelo?.val} fitKey={g.modelo?.val} />
        <Dato pending value={g.anio?.val} fitKey={String(g.anio?.val ?? "")} />
      </div>
    );
  }

  // marca: correct → bien · partial (mismo país) → cerca + bandera · wrong → mal
  const mSt = g.marca?.status;
  const marcaEstado = mSt === "correct" ? "bien" : mSt === "partial" ? "cerca" : "mal";
  const marcaApostilla =
    mSt === "partial" ? (
      <span className="prensa-apostilla">
        {g.marca?.pais && <img className="bandera" src={flagImagePath(g.marca.pais)} alt="" draggable={false} />}
        {t("cdd.sameCountry")}
      </span>
    ) : null;
  // Sin sr-only cuando la apostilla ya es texto visible (el lector la lee).
  const marcaSr = mSt === "correct" ? t("cdd.srCorrect") : mSt === "partial" ? null : t("cdd.srWrong");

  // modelo — binario.
  const moSt = g.modelo?.status;
  const modeloEstado = moSt === "correct" ? "bien" : "mal";
  const modeloSr = moSt === "correct" ? t("cdd.srCorrect") : t("cdd.srWrong");

  // año — correct → bien + "±tol"; wrong → apostilla con dirección (la flecha
  // dice hacia dónde está el año real: ↑ más nuevo, ↓ más antiguo).
  const aSt = g.anio?.status;
  let anioEstado, anioApostilla = null, anioSr;
  if (aSt === "correct") {
    anioEstado = "bien";
    anioApostilla = <span className="prensa-apostilla neutra">±{tolerance}</span>;
    anioSr = t("cdd.srCorrect");
  } else {
    anioEstado = "mal";
    const dir = g.anio?.direction;
    if (dir) {
      // Solo la flecha (↑ más nuevo · ↓ más antiguo): quitamos el texto para
      // ganar altura en la lista de intentos (la apostilla larga se partía en
      // dos líneas). El sentido no se pierde: la flecha es aria-hidden y la
      // dirección viaja al lector de pantalla como texto vía anioSr.
      anioApostilla = (
        <span className="prensa-apostilla">
          <Icon d={dir === "up" ? I.arrowU : I.arrowD} size={11} />
        </span>
      );
    }
    // Sin texto visible: el estado direccional se anuncia por sr-only.
    anioSr = dir ? t(dir === "up" ? "cdd.yearNewer" : "cdd.yearOlder") : t("cdd.srWrong");
  }

  return (
    <div className="prensa-fila">
      <span className="num">{numLabel}</span>
      <Dato estado={marcaEstado} value={g.marca?.val} fitKey={g.marca?.val} apostilla={marcaApostilla} srStatus={marcaSr} fresh={fresh} delay={d(0)} />
      <Dato estado={modeloEstado} value={g.modelo?.val} fitKey={g.modelo?.val} srStatus={modeloSr} fresh={fresh} delay={d(1)} />
      <Dato estado={anioEstado} value={g.anio?.val} fitKey={String(g.anio?.val ?? "")} apostilla={anioApostilla} srStatus={anioSr} fresh={fresh} delay={d(2)} />
    </div>
  );
}

export default function AttemptList({ guesses = [], pendingGuess = null, justRevealedIndex = -1, tolerance = 2 }) {
  const { t } = useT();
  if (!guesses.length && !pendingGuess) return null;
  // Cabecera de columnas alineada con la MISMA rejilla de las filas + filas
  // (más reciente primero). El estampado lo dispara justRevealedIndex.
  return (
    <section aria-label={t("cdd.lastAttempt")} className="flex flex-col">
      <div className="prensa-fila cabecera" aria-hidden="true">
        <span className="num"></span>
        <span>{t("cdd.labelMarca")}</span>
        <span>{t("cdd.labelModelo")}</span>
        <span>{t("cdd.labelAnio")}</span>
      </div>
      {pendingGuess && (
        <AttemptRow key="pending" g={pendingGuess} tolerance={tolerance} pending num={guesses.length + 1} />
      )}
      {guesses
        .map((g, i) => ({ g, i }))
        .reverse()
        .map(({ g, i }) => (
          <AttemptRow key={i} g={g} tolerance={tolerance} fresh={i === justRevealedIndex} num={i + 1} />
        ))}
    </section>
  );
}
