// src/components/configurator/AttemptList.jsx
// Clasificación «Prensa del motor»: cada intento es una FILA numerada (01…)
// con tres datos en Fraunces y veredictos como MARCAS DE CORRECTOR.
// Verde = correcto, rojo = incorrecto (la convención universal y lo que promete
// el modal «Cómo se juega»):
//   acierto → subrayado VERDE firme + ✓ · cerca → subrayado ÁMBAR discontinuo +
//   apostilla "mismo país" (bandera) · fallo → tachado a pluma ROJA. La flecha
//   ↑/↓ del año (más nuevo/antiguo) va EN LÍNEA con la cifra, no en apostilla.
// (El color vive en index.css: .prensa-dato.bien/.cerca/.mal.)
// Fondos transparentes: la fila es tipografía + filete, no un chip. Feedback
// REAL del servidor (correct/partial/wrong + dirección), doble codificación
// marca+texto (accesible; el estado exacto va también en sr-only). Pendiente =
// "entintado" (pulso de opacidad); recién validada = estampado.

import { useT } from "../../i18n";
import { flagImagePath } from "../../data/countries";
import { Icon, I } from "./icons";
import { useFitText } from "../../hooks/useFitText";

// Stagger del estampado por celda: la cascada marca → modelo → año se lee con
// calma, como tres golpes de tampón.
//
// 110 ms y no 120 porque estos tres golpes son los tres primeros tiempos de una
// frase de CUATRO: el cuarto es la fotografía abriéndose, que arranca en el
// milisegundo 280 (`--ms-sello`, el retardo de la transición en CarImage). Con
// 110 el último sello cae en el 220 y la foto entra justo detrás; con 120 el
// tercer golpe y la foto se pisaban.
//
// Si tocas este número, mira el retardo de la foto en CarImage.jsx — son las
// dos mitades del mismo compás y no hay nada que las ate salvo esta nota.
const STAGGER_MS = 110;

function Dato({ estado, pending, value, apostilla, hint, srStatus, fresh, delay, fitKey }) {
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
        {/* Pista EN LÍNEA (la flecha ↑/↓ del año): vive dentro del span medido por
            useFitText, así que encoge con la cifra y no gasta un renglón extra. */}
        {!pending && hint}
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

  // año — correct → bien + "±tol" (apostilla neutra debajo); wrong → flecha EN
  // LÍNEA con la cifra (↑ más nuevo, ↓ más antiguo: hacia dónde está el real).
  const aSt = g.anio?.status;
  let anioEstado, anioApostilla = null, anioHint = null, anioSr;
  if (aSt === "correct") {
    anioEstado = "bien";
    anioApostilla = <span className="prensa-apostilla neutra">±{tolerance}</span>;
    anioSr = t("cdd.srCorrect");
  } else {
    anioEstado = "mal";
    const dir = g.anio?.direction;
    if (dir) {
      // Flecha EN LÍNEA con la cifra (antes iba de apostilla debajo y gastaba un
      // renglón por fila). Sin texto: el sentido viaja al lector de pantalla vía
      // anioSr y la flecha es aria-hidden.
      anioHint = (
        <span className="prensa-dir" aria-hidden="true">
          <Icon d={dir === "up" ? I.arrowU : I.arrowD} size={11} />
        </span>
      );
    }
    anioSr = dir ? t(dir === "up" ? "cdd.yearNewer" : "cdd.yearOlder") : t("cdd.srWrong");
  }

  return (
    <div className="prensa-fila">
      <span className="num">{numLabel}</span>
      <Dato estado={marcaEstado} value={g.marca?.val} fitKey={g.marca?.val} apostilla={marcaApostilla} srStatus={marcaSr} fresh={fresh} delay={d(0)} />
      <Dato estado={modeloEstado} value={g.modelo?.val} fitKey={g.modelo?.val} srStatus={modeloSr} fresh={fresh} delay={d(1)} />
      <Dato estado={anioEstado} value={g.anio?.val} fitKey={String(g.anio?.val ?? "")} apostilla={anioApostilla} hint={anioHint} srStatus={anioSr} fresh={fresh} delay={d(2)} />
    </div>
  );
}

export default function AttemptList({ guesses = [], pendingGuess = null, justRevealedIndex = -1, tolerance = 2 }) {
  const { t } = useT();
  if (!guesses.length && !pendingGuess) return null;
  // Cabecera de columnas alineada con la MISMA rejilla de las filas + filas
  // (más reciente primero). El estampado lo dispara justRevealedIndex.
  return (
    // El aria-label era `cdd.lastAttempt` («Último intento»), heredado de cuando
    // esta lista convivía con la fila viva y solo mostraba los ANTERIORES.
    // Retirada la fila, esta sección es el historial entero y así se anuncia.
    <section aria-label={t("guessLog.label")} className="flex flex-col">
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
