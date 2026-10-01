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

import { useEffect, useRef } from "react";
import { useT } from "../../i18n";
import { menosMovimiento } from "../../lib/movimiento";
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

export default function AttemptList({
  guesses = [],
  pendingGuess = null,
  justRevealedIndex = -1,
  tolerance = 2,
  // Modo TABLERO (lo pide la partida diaria mientras se juega; la Repesca sigue
  // con la lista de siempre). Ver <Tablero> más abajo.
  tablero = false,
  maxAttempts = 5,
  nota = null,
  huecoTextos = null,
}) {
  const { t } = useT();
  if (tablero) {
    return (
      <Tablero
        guesses={guesses}
        pendingGuess={pendingGuess}
        justRevealedIndex={justRevealedIndex}
        tolerance={tolerance}
        maxAttempts={maxAttempts}
        nota={nota}
        huecoTextos={huecoTextos}
      />
    );
  }
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

// ── EL TABLERO ───────────────────────────────────────────────────────────────
// La partida diaria, mientras se juega, pinta los CINCO renglones desde el
// primer momento: los gastados con su veredicto y los que quedan como huecos
// numerados. Es lo que hace que un juego de adivinar se entienda sin leer nada
// —ves el tablero y sabes cuántas oportunidades tienes— y lo que le faltaba a
// esta pantalla, que sin él era un formulario: tres campos y un botón de enviar.
//
// Y cambia cómo cae el primer fallo. Sin tablero, el intento fallado aparecía
// solo, tachado entero, y se leía como una derrota. Con tablero cae en el
// renglón «01» de cinco: se lee como un paso. Es justo el momento que más
// jugadores nuevos perdía (ver lib/primeraPartida.js).
//
// ORDEN CRONOLÓGICO, de arriba abajo, y no «el más reciente primero» como la
// lista de siempre: en un tablero cada intento tiene SU renglón y no se mueve.
// El precio es que en la app, donde el tablero vive en una banda con scroll
// propio, el último intento puede quedar por debajo del borde; por eso se trae
// a la vista al llegar (ver el efecto de abajo).
//
// El hueco vive en el MISMO espacio que ya reservaba Configurator para el
// historial (`reservaHistorial`): no se le quita un píxel a la fotografía.
function Tablero({ guesses, pendingGuess, justRevealedIndex, tolerance, maxAttempts, nota, huecoTextos }) {
  const { t } = useT();
  const ref = useRef(null);
  const usados = guesses.length + (pendingGuess ? 1 : 0);
  const huecos = Math.max(0, maxAttempts - usados);
  const restantes = Math.max(0, maxAttempts - guesses.length);
  const hayNota = Boolean(nota);

  // EL ÚLTIMO INTENTO, SIEMPRE A LA VISTA. Solo actúa si el contenedor tiene
  // scroll propio (la banda del historial en la app): en la web el tablero es
  // parte de un documento que se lee bajando y mover la página por él sería
  // robarle el scroll al jugador.
  //
  // Lo ideal es enseñar el renglón recién llegado Y lo que viene detrás (la nota
  // de la primera partida o el hueco siguiente): así el ojo encuentra a la vez
  // qué acaba de pasar y cuánto queda. Si no caben los dos —un 360x640 deja una
  // banda de dos dedos—, manda el intento: se alinea arriba y lo demás se
  // desliza. Lo que no puede pasar es lo que pasaba con una cuenta ingenua, que
  // la banda se quedara enseñando medio renglón de cada uno.
  //
  // La primera vez que hay intentos que enseñar va sin animación (al abrir una
  // partida empezada —los navegadores in-app recargan al volver— no hay nada
  // que seguir con la vista); después, suave salvo movimiento reducido. Cuenta
  // desde el primer render CON intentos y no desde el montaje, porque en una
  // recarga los intentos llegan del servidor un instante después.
  const primeraVez = useRef(true);
  useEffect(() => {
    if (usados === 0) return;
    const inicial = primeraVez.current;
    primeraVez.current = false;
    const seccion = ref.current;
    const banda = seccion?.parentElement;
    if (!seccion || !banda || banda.scrollHeight <= banda.clientHeight + 1) return;

    // Hijos en orden: filas llenas (y la entintada), la nota, los huecos.
    const piezas = seccion.querySelectorAll(":scope > .prensa-fila, :scope > .prensa-nota");
    const intento = piezas[usados - 1];
    const detras = piezas[usados] ?? null;
    if (!intento) return;

    // Posiciones en el espacio del scroll, y el alto ÚTIL: los últimos 12px
    // los funde la máscara del canto (ver `.prensa-historial` en index.css).
    const caja = banda.getBoundingClientRect();
    const enScroll = (el, lado) => el.getBoundingClientRect()[lado] - caja.top + banda.scrollTop;
    const util = banda.clientHeight - 12;
    const arriba = enScroll(intento, "top");
    const abajo = enScroll(detras ?? intento, "bottom");
    const objetivo = Math.max(0, abajo - arriba <= util ? abajo - util : arriba);
    // Si lo que importa ya está a la vista, no se toca nada: la banda solo se
    // mueve cuando el intento (o lo que va detrás) ha quedado fuera.
    if (objetivo > banda.scrollTop + 1 || arriba < banda.scrollTop) {
      banda.scrollTo({ top: objetivo, behavior: inicial || menosMovimiento() ? "auto" : "smooth" });
    }
  // `hayNota` y no `nota`: la nota es un elemento JSX nuevo en cada render de
  // Configurator, que se repinta cada segundo con el reloj del pie. Con el
  // objeto como dependencia, este efecto volvería a desplazar la banda una vez
  // por segundo y le quitaría el scroll de las manos al jugador.
  }, [usados, hayNota]);

  return (
    <section ref={ref} aria-label={t("guessLog.label")} className="prensa-tablero flex flex-col">
      {/* Los huecos son decorado para quien ve; quien escucha recibe la cuenta. */}
      <p className="sr-only">{t("app.attemptsRemainingAria", { count: restantes, max: maxAttempts })}</p>
      {/* Los huecos son `aria-hidden`, así que lo que explican se dice aquí. */}
      {huecoTextos?.length > 0 && <p className="sr-only">{huecoTextos.join(". ")}</p>}
      {guesses.map((g, i) => (
        <AttemptRow key={i} g={g} tolerance={tolerance} fresh={i === justRevealedIndex} num={i + 1} />
      ))}
      {pendingGuess && (
        <AttemptRow key="pending" g={pendingGuess} tolerance={tolerance} pending num={guesses.length + 1} />
      )}
      {nota}
      {Array.from({ length: huecos }, (_, k) => {
        const num = usados + k + 1;
        // El SIGUIENTE hueco se distingue (número en tinta plena): es donde va a
        // caer el próximo intento. Mientras hay uno entintándose, el siguiente
        // es ese, y ya lleva su propia fila.
        const siguiente = k === 0 && !pendingGuess;
        return (
          <div
            key={"hueco-" + num}
            className={"prensa-fila prensa-fila-hueco" + (siguiente ? " siguiente" : "")}
            aria-hidden="true"
          >
            <span className="num">{String(num).padStart(2, "0")}</span>
            {/* Los textos van por posición a partir del primer hueco libre (ver
                `huecoTextos` en Configurator): el 01 dice qué es la foto y qué
                hacer, el 02 qué pasa si fallas. Con un intento entintándose no
                se pinta ninguno — ya no es el momento de explicar. */}
            <span className="hueco">{!pendingGuess ? huecoTextos?.[k] ?? null : null}</span>
          </div>
        );
      })}
    </section>
  );
}
