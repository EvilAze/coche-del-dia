// src/components/configurator/SelectorAnio.jsx
// El selector de AÑO en la app: una RULETA con trinquete, y las décadas encima
// como saltos rápidos. Sin teclear un dígito.
//
// POR QUÉ NO UN TECLADO NUMÉRICO. Tres razones, y la tercera es la buena:
//   1. Es el único campo que quedaba abriendo teclado, y con él volvían el
//      salto de maqueta y la foto tapada. Un solo campo no justifica arrastrar
//      todo eso.
//   2. Teclear cuatro cifras son cuatro toques; saltar de década y girar, uno o
//      dos gestos.
//   3. LA HORQUILLA SE CONVIERTE EN EL PROPIO CONTROL. El juego ya sabe, por
//      las flechas ↑/↓ de los intentos anteriores, qué años son imposibles. La
//      ruleta solo contiene los años POSIBLES: la deducción deja de ser una nota
//      que hay que recordar y pasa a ser el largo de la rueda, que encoge
//      intento a intento. De paso desaparece el intento tirado a la basura por
//      elegir un año que el propio juego ya había descartado.
//
// POR QUÉ UNA RULETA Y NO LA REJILLA DE DIEZ AÑOS QUE HUBO. La rejilla era más
// rápida para saltar lejos y peor en todo lo demás: diez botones iguales que
// se leían como un formulario. La ruleta es el gesto del configurador —la
// rueda de un reloj, el selector de una alarma—, y con un tic por año se SIENTE
// pasar el tiempo bajo el dedo (haptic.muesca). Su punto débil es la distancia
// —el primer intento tiene 140 años de rueda—, y para eso se quedan las
// décadas: tocar «1960» la hace girar hasta allí conservando el año dentro de
// la década (1994 → 1964), que es casi siempre lo que se buscaba.
//
// ELEGIR ES CONFIRMAR, NO SOLTAR. El año centrado es una propuesta; lo fija el
// botón (o tocar la fila ya centrada). Cerrar la hoja al dejar de girar
// obligaría a acertar a la primera con el pulgar, y un giro que se pasa de
// largo cerraría la hoja con el año equivocado.
//
// NO REVELA NADA NUEVO (regla 5): lo que se deja fuera sale de las respuestas
// que el servidor ya le ha dado a ESTE jugador por sus propios intentos, y la
// década de partida sale del catálogo público entero (ver `anioHabitual`).

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { haptic } from "../../lib/haptics";
import { menosMovimiento } from "../../lib/movimiento";
import { MS } from "../../lib/compas";
import { useT } from "../../i18n";

const MIN_YEAR = 1886;
const MAX_YEAR = new Date().getFullYear();

// Alto de una fila de la ruleta. 44px: el mínimo táctil, y además el paso del
// imán (scroll-snap). El CSS lo recibe por `--ruleta-fila` desde aquí para que
// la aritmética de este fichero y la maqueta no puedan desacompasarse.
const FILA = 44;

const decadaDe = (anio) => Math.floor(anio / 10) * 10;
const acotar = (n, min, max) => Math.min(Math.max(n, min), max);

/**
 * El texto de la horquilla: «Entre 1974 y 1989», «1974 o posterior», «±2 años».
 * Lo comparten la cabecera de esta hoja y la nota al pie del renglón del cupón,
 * y tienen que decir EXACTAMENTE lo mismo: si el renglón promete un rango y la
 * hoja enseña otro, el jugador deja de fiarse de los dos.
 * (Gemelo del cálculo que YearField hace para la web, que en este cambio no se
 * toca. El día que la web también pase a selectores, se queda solo este.)
 */
export function textoHorquilla(t, horquilla, tolerance) {
  if (!horquilla?.acotada) return t("cdd.yearTolerance", { n: tolerance });
  const { min, max } = horquilla;
  if (min > MIN_YEAR && max < MAX_YEAR) return t("cdd.yearRangeBetween", { min, max });
  if (min > MIN_YEAR) return t("cdd.yearRangeFrom", { min });
  return t("cdd.yearRangeTo", { max });
}

// Las filas, aparte y memorizadas: la ruleta re-renderiza en cada año que pasa
// por el centro (cambia el botón y aria-valuenow), y repintar ciento cuarenta
// filas por muesca en mitad de un giro es justo el trabajo de hilo principal
// que la regla 25 no quiere en un gesto. Las filas no dependen del año elegido:
// el resalte lo dibujan la banda fija y la animación por scroll del CSS.
const Filas = memo(function Filas({ anios, onTocar }) {
  return anios.map((a) => (
    <div key={a} className="pm-ruleta-fila" aria-hidden="true" onClick={() => onTocar(a)}>
      {a}
    </div>
  ));
});

// Contenido de la hoja, no la hoja (ver SelectorLista y GuessForm).
export default function SelectorAnio({
  valor,
  onElegir,
  // Horquilla viva: { min, max, acotada } de lib/yearRange, la misma que recibe
  // YearField en la web.
  horquilla = null,
  tolerance = 2,
  // El año «típico» del catálogo (su mediana, ver GuessForm), para abrir en
  // algún sitio con sentido cuando todavía no hay pista. Sale del catálogo
  // ENTERO, no del modelo elegido: abrir en la década del modelo sería regalar
  // el año en cuanto se acierta el modelo.
  anioHabitual = null,
}) {
  const { t } = useT();
  const tiraRef = useRef(null);
  const visorRef = useRef(null);

  // Los extremos que el juego ACEPTARÍA. Se calculan con la misma cuenta que
  // hace la validación de GuessForm al enviar (`min - tolerance`,
  // `max + tolerance`): si aquí se dejara fuera un año que allí se acepta, el
  // selector estaría mintiendo sobre las reglas.
  const [suelo, techo] = useMemo(() => {
    if (!horquilla?.acotada) return [MIN_YEAR, MAX_YEAR];
    return [
      Math.max(MIN_YEAR, horquilla.min - tolerance),
      Math.min(MAX_YEAR, horquilla.max + tolerance),
    ];
  }, [horquilla, tolerance]);

  const anios = useMemo(() => {
    const out = [];
    for (let a = suelo; a <= techo; a++) out.push(a);
    return out;
  }, [suelo, techo]);

  // Décadas que contienen algún año todavía posible. En el primer intento son
  // todas; en el cuarto suelen quedar una o dos, y la tira se lee de un vistazo.
  const decadas = useMemo(() => {
    const out = [];
    for (let d = decadaDe(suelo); d <= decadaDe(techo); d += 10) out.push(d);
    return out;
  }, [suelo, techo]);

  // Dónde se abre: el año ya elegido si lo hay; si no, con pista, el CENTRO de
  // lo que queda vivo; y sin pista, el año típico del catálogo.
  //
  // Ese último caso era antes también «el centro», y el centro de 1886-hoy cae
  // en los cincuenta: la hoja abría en 1950-1959 —la década con menos coches del
  // catálogo después de las de preguerra— y con «1955» a mano para el primer
  // toque distraído. La mediana del catálogo cae en los noventa, que es además
  // la década con más coches.
  //
  // Inicializador perezoso y no efecto: el primer render ya sale con su año (con
  // un efecto, la hoja se abría un frame vacía). Este componente nace y muere
  // con su paso de la hoja, así que montar ES abrir.
  const [pendiente, setPendiente] = useState(() => {
    const centro = valor
      ? Number(valor)
      : !horquilla?.acotada && anioHabitual
      ? anioHabitual
      : Math.round((suelo + techo) / 2);
    return acotar(centro, suelo, techo);
  });
  // El año centrado, también en un ref: lo leen el manejador de scroll y el de
  // las filas, que son estables (no se recrean en cada muesca).
  const pendienteRef = useRef(pendiente);
  // Mientras la ruleta gira SOLA (un salto de década, las flechas del teclado)
  // no suena el trinquete: treinta muescas seguidas no le dicen nada a quien no
  // está girando, y el salto ya tiene su propio háptico al tocar la década.
  const giroAutomaticoRef = useRef(false);
  const finGiroRef = useRef(null);
  useEffect(() => () => clearTimeout(finGiroRef.current), []);

  const decadaActiva = decadaDe(pendiente);

  // Al abrir, la ruleta ya está en su año y la década activa a la vista: se fija
  // `scrollTop`/`scrollLeft` a mano, sin scrollIntoView, que también desplazaría
  // en vertical la hoja que lo contiene.
  useLayoutEffect(() => {
    const visor = visorRef.current;
    if (visor) visor.scrollTop = (pendienteRef.current - suelo) * FILA;
    // Solo al montar: después la mueven el dedo y las décadas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // La década activa nunca se queda fuera de la tira. Antes la rejilla podía
  // enseñar 1950-1959 con el chip «1950» fuera por la izquierda, y nada en
  // pantalla decía en qué década se estaba. Solo se mueve si el chip NO se ve:
  // re-centrarla en cada década que cruza un giro haría bailar la tira.
  useLayoutEffect(() => {
    const tira = tiraRef.current;
    const chip = tira?.querySelector(".pm-decada.activa");
    if (!chip) return;
    const fuera = chip.offsetLeft < tira.scrollLeft
      || chip.offsetLeft + chip.offsetWidth > tira.scrollLeft + tira.clientWidth;
    if (fuera) tira.scrollLeft = chip.offsetLeft - (tira.clientWidth - chip.offsetWidth) / 2;
  }, [decadaActiva]);

  // EL TRINQUETE. Chromium entrega `scroll` como mucho una vez por frame, así que
  // esto no necesita su propio rAF: una lectura de `scrollTop` (que no fuerza
  // layout: el gesto solo desplaza) y, si el año del centro ha cambiado, una
  // muesca. Nada de escribir estilos aquí: el aspecto de cada fila lo anima el
  // compositor (ver `.pm-ruleta-fila` en index.css, regla 25).
  const alDesplazar = useCallback(() => {
    const visor = visorRef.current;
    if (!visor) return;
    const a = suelo + acotar(Math.round(visor.scrollTop / FILA), 0, techo - suelo);
    if (a === pendienteRef.current) return;
    pendienteRef.current = a;
    setPendiente(a);
    if (!giroAutomaticoRef.current) haptic.muesca();
  }, [suelo, techo]);

  // Girar la ruleta hasta un año, desde código. El estado se fija YA (el botón
  // dice el destino desde el primer frame, y en jsdom no hay scroll que lo
  // haga); el desplazamiento suave va detrás.
  const irA = useCallback((a, suave) => {
    const destino = acotar(a, suelo, techo);
    pendienteRef.current = destino;
    setPendiente(destino);
    const visor = visorRef.current;
    if (!visor) return;
    const top = (destino - suelo) * FILA;
    if (typeof visor.scrollTo !== "function") { visor.scrollTop = top; return; }
    giroAutomaticoRef.current = true;
    visor.scrollTo({ top, behavior: suave && !menosMovimiento() ? "smooth" : "auto" });
    // Fin del giro: `scrollend` cuando el WebView lo tiene, y un plazo de
    // respaldo por si no llega (un destino donde ya estaba no desplaza nada).
    const terminar = () => {
      giroAutomaticoRef.current = false;
      clearTimeout(finGiroRef.current);
      visor.removeEventListener("scrollend", terminar);
    };
    visor.addEventListener("scrollend", terminar);
    clearTimeout(finGiroRef.current);
    finGiroRef.current = setTimeout(terminar, MS.revelado);
  }, [suelo, techo]);

  function confirmar() {
    haptic.selection();
    onElegir(pendienteRef.current);
  }

  // Tocar una fila la trae al centro; tocar la que YA está en el centro la
  // elige. Es el atajo de quien ve su año a dos filas y no quiere ir al botón.
  const tocarFila = useCallback((a) => {
    if (a === pendienteRef.current) {
      haptic.selection();
      onElegir(a);
      return;
    }
    haptic.selection();
    irA(a, true);
  }, [irA, onElegir]);

  function saltarADecada(d) {
    haptic.selection();
    // Se conserva el año dentro de la década (1994 → 1964), acotado a lo que
    // sigue siendo posible.
    irA(acotar(d + (pendienteRef.current % 10), Math.max(suelo, d), Math.min(techo, d + 9)), true);
  }

  // El teclado (y los lectores de pantalla, que manejan un spinbutton con estas
  // mismas teclas): la ruleta es un control completo sin dedo.
  function alTeclear(e) {
    const a = pendienteRef.current;
    const paso = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }[e.key];
    if (paso) { e.preventDefault(); irA(a + paso, false); return; }
    if (e.key === "Home") { e.preventDefault(); irA(suelo, false); return; }
    if (e.key === "End") { e.preventDefault(); irA(techo, false); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); confirmar(); }
  }

  return (
    <>
      {/* Las décadas: saltos, no el control. Se desplaza en horizontal cuando
          están todas; en cuanto la horquilla aprieta, cabe entera. */}
      <div ref={tiraRef} className="pm-decadas" role="tablist" aria-label={t("cdd.selectorDecade")}>
        {decadas.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={d === decadaActiva}
            className={"pm-decada" + (d === decadaActiva ? " activa" : "")}
            onClick={() => saltarADecada(d)}
          >
            {d}
          </button>
        ))}
      </div>

      {/* LA RULETA. `data-gesto-propio`: el vertical es suyo, no del arrastre
          de la hoja (sin esto, girar hacia abajo estando en el primer año
          arrastraría la hoja y la cerraría, ver useArrastreHoja). Y
          `data-sin-tacto`: el acuse de recibo del dedo (lib/tacto.js) sonaría
          al empezar cada giro, encima de la primera muesca. */}
      <div
        className="pm-ruleta"
        data-gesto-propio=""
        data-sin-tacto=""
        style={{ "--ruleta-fila": `${FILA}px` }}
      >
        <div className="pm-ruleta-banda" aria-hidden="true" />
        <div
          ref={visorRef}
          className="pm-ruleta-visor"
          role="spinbutton"
          tabIndex={0}
          aria-label={t("cdd.labelAnio")}
          aria-valuemin={suelo}
          aria-valuemax={techo}
          aria-valuenow={pendiente}
          onScroll={alDesplazar}
          onKeyDown={alTeclear}
        >
          <Filas anios={anios} onTocar={tocarFila} />
        </div>
      </div>

      <button type="button" className="pm-ruleta-ok" onClick={confirmar}>
        {t("cdd.selectorYearConfirm", { year: pendiente })}
      </button>
    </>
  );
}
