// src/components/configurator/AttemptList.jsx
// El historial «Asfalto»: cada intento es una FILA numerada con tres CELDAS
// (marca, modelo, año). Verde = correcto, ámbar = mismo país, el fallo en
// superficie neutra con el valor tachado: la convención universal, la que
// promete «Cómo se juega». NUNCA SOLO COLOR: cada celda lleva además su nota
// escrita debajo («Correcto», «No es», «Mismo país» con la bandera, «Más
// nuevo»…) y el ✓ o la flecha en línea con el valor. (El color vive en
// index.css: .prensa-dato.bien/.cerca/.mal.) Feedback REAL del servidor
// (correct/partial/wrong + dirección); la nota visible va aria-hidden porque el
// estado exacto ya viaja en sr-only. Pendiente = "entintado" (pulso de
// opacidad); recién validada = estampado.

import { useEffect, useRef } from "react";
import { useT } from "../../i18n";
import { menosMovimiento } from "../../lib/movimiento";
import { flagImagePath } from "../../data/countries";
import { Icon, I } from "./icons";
import { useFitText } from "../../hooks/useFitText";
// Stagger del estampado por celda: la cascada marca → modelo → año se lee con
// calma, como tres golpes de tampón. El número vive en lib/veredicto.js porque
// ya no es solo de la tinta: el patrón háptico de la frase (haptic.veredicto)
// golpea con el MISMO paso, y dos copias del 110 se desafinarían. El porqué del
// 110 —y su relación con el retardo de la foto en CarImage— está allí.
import { PASO_VEREDICTO_MS as STAGGER_MS } from "../../lib/veredicto";

// Las notas de las celdas van en caja de frase («Más antiguo», «Mismo país»):
// las cadenas de i18n están en versalitas porque así se pintaban en la prensa,
// y en una celda estrecha las mayúsculas no caben. Se respeta el idioma.
function enFrase(texto, locale) {
  if (!texto) return texto;
  const bajo = texto.toLocaleLowerCase(locale);
  return bajo.charAt(0).toLocaleUpperCase(locale) + bajo.slice(1);
}

function Dato({ estado, pending, value, apostilla, nota, tipo, hint, srStatus, fresh, delay, fitKey }) {
  // Auto-ajuste del nombre a una línea: el wrapper bloque da el ancho de la
  // celda al hook; la .palabra inline mantiene el subrayado/tachado AL ANCHO
  // DE LA PALABRA (es una marca de corrector, no un borde de caja).
  const textRef = useFitText(fitKey);
  return (
    <div
      className={
        "prensa-dato " +
        (pending ? "" : estado) +
        (tipo ? " " + tipo : "") +
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
      {/* La nota del veredicto, cuando no hay apostilla que ya lo diga: así
          cada celda se entiende sin distinguir colores. */}
      {!pending && !apostilla && nota && (
        <span className="prensa-apostilla nota" aria-hidden="true">{nota}</span>
      )}
    </div>
  );
}

// Exportada: el Configurator la reusa para la "fila viva" del último intento.
// `num` es el ordinal 1-based del intento (para el 01… de la izquierda).
export function AttemptRow({ g, tolerance = 2, pending, fresh, num = null }) {
  const { t, locale } = useT();
  const d = (i) => (fresh ? i * STAGGER_MS + "ms" : undefined);
  const numLabel = num ? String(num).padStart(2, "0") : "";

  if (pending) {
    return (
      <div className="prensa-fila prensa-fila-pendiente">
        <span className="num">{numLabel}</span>
        <Dato pending value={g.marca?.val} fitKey={g.marca?.val} />
        <Dato pending value={g.modelo?.val} fitKey={g.modelo?.val} />
        <Dato pending tipo="anio" value={g.anio?.val} fitKey={String(g.anio?.val ?? "")} />
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
        {enFrase(t("cdd.sameCountry"), locale)}
      </span>
    ) : null;
  // Sin sr-only cuando la apostilla ya es texto visible (el lector la lee).
  const marcaSr = mSt === "correct" ? t("cdd.srCorrect") : mSt === "partial" ? null : t("cdd.srWrong");
  const marcaNota = mSt === "correct" ? t("cdd.notaBien") : mSt === "partial" ? null : t("cdd.notaMal");

  // modelo — binario.
  const moSt = g.modelo?.status;
  const modeloEstado = moSt === "correct" ? "bien" : "mal";
  const modeloSr = moSt === "correct" ? t("cdd.srCorrect") : t("cdd.srWrong");
  const modeloNota = moSt === "correct" ? t("cdd.notaBien") : t("cdd.notaMal");

  // año — correct → bien + "±tol" (apostilla neutra debajo); wrong → flecha EN
  // LÍNEA con la cifra (↑ más nuevo, ↓ más antiguo: hacia dónde está el real).
  const aSt = g.anio?.status;
  let anioEstado, anioApostilla = null, anioHint = null, anioSr, anioNota = null;
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
    anioNota = dir ? enFrase(anioSr, locale) : t("cdd.notaMal");
  }

  return (
    <div className="prensa-fila">
      <span className="num">{numLabel}</span>
      <Dato estado={marcaEstado} value={g.marca?.val} fitKey={g.marca?.val} apostilla={marcaApostilla} nota={marcaNota} srStatus={marcaSr} fresh={fresh} delay={d(0)} />
      <Dato estado={modeloEstado} value={g.modelo?.val} fitKey={g.modelo?.val} nota={modeloNota} srStatus={modeloSr} fresh={fresh} delay={d(1)} />
      <Dato estado={anioEstado} tipo="anio" value={g.anio?.val} fitKey={String(g.anio?.val ?? "")} apostilla={anioApostilla} nota={anioNota} hint={anioHint} srStatus={anioSr} fresh={fresh} delay={d(2)} />
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
  // Filas en ORDEN DE JUEGO, 01 arriba, como el tablero. Iban al revés (lo más
  // reciente primero), y como el tablero solo se usa mientras se juega la
  // partida diaria, el historial cambiaba de sentido justo al terminar: 01→04
  // durante, 04→01 después (auditoría 7-oct). La fila entintada va al final,
  // donde nacerá el intento. El estampado lo dispara justRevealedIndex.
  return (
    // El aria-label era `cdd.lastAttempt` («Último intento»), heredado de cuando
    // esta lista convivía con la fila viva y solo mostraba los ANTERIORES.
    // Retirada la fila, esta sección es el historial entero y así se anuncia.
    <section aria-label={t("guessLog.label")} className="flex flex-col">
      {guesses.map((g, i) => (
        <AttemptRow key={i} g={g} tolerance={tolerance} fresh={i === justRevealedIndex} num={i + 1} />
      ))}
      {pendingGuess && (
        <AttemptRow key="pending" g={pendingGuess} tolerance={tolerance} pending num={guesses.length + 1} />
      )}
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
