// src/components/configurator/SelectorAnio.jsx
// El selector de AÑO en la app: décadas y años, sin teclear un dígito.
//
// POR QUÉ NO UN TECLADO NUMÉRICO. Tres razones, y la tercera es la buena:
//   1. Es el único campo que quedaba abriendo teclado, y con él volvían el
//      salto de maqueta y la foto tapada. Un solo campo no justifica arrastrar
//      todo eso.
//   2. Teclear cuatro cifras son cuatro toques; elegir década y año son dos.
//   3. LA HORQUILLA SE CONVIERTE EN EL PROPIO CONTROL. El juego ya sabe, por
//      las flechas ↑/↓ de los intentos anteriores, qué años son imposibles; y
//      hasta ahora eso vivía como una nota al pie que había que leer y
//      recordar. Aquí los años descartados salen apagados y no se pueden
//      pulsar: la deducción deja de ser un texto y pasa a ser la forma del
//      mando. De paso desaparece el intento tirado a la basura por teclear un
//      año que el propio juego ya había descartado — que era el error más caro
//      del juego, porque en una partida de cinco regalar uno duele.
//
// NO REVELA NADA NUEVO (regla 5): lo que se apaga sale de las respuestas que el
// servidor ya le ha dado a ESTE jugador por sus propios intentos. Es la misma
// información que ya pintaba `.prensa-horquilla` bajo el campo, con otra forma.

import { useMemo, useState } from "react";
import { haptic } from "../../lib/haptics";
import { useT } from "../../i18n";

const MIN_YEAR = 1886;
const MAX_YEAR = new Date().getFullYear();

const decadaDe = (anio) => Math.floor(anio / 10) * 10;

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

// Contenido de la hoja, no la hoja (ver SelectorLista y GuessForm).
export default function SelectorAnio({
  valor,
  onElegir,
  // Horquilla viva: { min, max, acotada } de lib/yearRange, la misma que recibe
  // YearField en la web.
  horquilla = null,
  tolerance = 2,
}) {
  const { t } = useT();

  // Los extremos que el juego ACEPTARÍA. Se calculan con la misma cuenta que
  // hace la validación de GuessForm al enviar (`min - tolerance`,
  // `max + tolerance`): si aquí se apagara un año que allí se acepta, el
  // selector estaría mintiendo sobre las reglas.
  const [suelo, techo] = useMemo(() => {
    if (!horquilla?.acotada) return [MIN_YEAR, MAX_YEAR];
    return [
      Math.max(MIN_YEAR, horquilla.min - tolerance),
      Math.min(MAX_YEAR, horquilla.max + tolerance),
    ];
  }, [horquilla, tolerance]);

  // Décadas que contienen algún año todavía posible. En el primer intento son
  // todas (1880-2020); en el cuarto suelen quedar una o dos, y la tira se lee
  // de un vistazo — el propio progreso de la partida encoge el mando.
  const decadas = useMemo(() => {
    const out = [];
    for (let d = decadaDe(suelo); d <= decadaDe(techo); d += 10) out.push(d);
    return out;
  }, [suelo, techo]);

  // La década que más probablemente busca el jugador: la del valor ya elegido si
  // lo hay, y si no la del CENTRO de lo que queda vivo. Abrir siempre en 1880
  // obligaría a arrastrar la tira entera cada vez.
  //
  // Se calcula en el INICIALIZADOR PEREZOSO del estado, no en un efecto de
  // montaje. Con el efecto, el primer render salía con `decada = null` y la
  // rejilla de años vacía; el valor entraba en el commit siguiente, así que la
  // hoja del año se abría con un hueco y los años aparecían de golpe un frame
  // después. La cuenta no necesita el DOM ni depende de nada montado: es
  // exactamente lo que un inicializador perezoso existe para hacer, y de paso
  // ahorra el render extra.
  //
  // Sigue siendo "solo al abrir" sin lista de dependencias que mantener: este
  // componente nace y muere con su paso de la hoja, así que montar ES abrir.
  const [decada, setDecada] = useState(() => {
    const centro = valor ? Number(valor) : Math.round((suelo + techo) / 2);
    const d = decadaDe(Math.min(Math.max(centro, suelo), techo));
    return decadas.includes(d) ? d : decadas[0];
  });

  const anios = useMemo(() => {
    if (decada == null) return [];
    const out = [];
    for (let a = decada; a < decada + 10; a++) {
      if (a < MIN_YEAR || a > MAX_YEAR) continue;
      out.push({ anio: a, posible: a >= suelo && a <= techo });
    }
    return out;
  }, [decada, suelo, techo]);

  function elegir(anio) {
    haptic.selection();
    onElegir(anio);
  }

  return (
    <>
      {/* La tira de décadas. Se desplaza en horizontal cuando están todas; en
          cuanto la horquilla aprieta, cabe entera. */}
      <div className="pm-decadas" role="tablist" aria-label={t("cdd.selectorDecade")}>
        {decadas.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={d === decada}
            className={"pm-decada" + (d === decada ? " activa" : "")}
            onClick={() => { haptic.selection(); setDecada(d); }}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="pm-anios">
        {anios.map(({ anio, posible }) => (
          <button
            key={anio}
            type="button"
            disabled={!posible}
            className={
              "pm-anio" +
              (String(anio) === String(valor) ? " elegido" : "") +
              (posible ? "" : " descartado")
            }
            // El apagado necesita decir POR QUÉ a quien no ve el contraste: sin
            // esto, un lector de pantalla solo anuncia "no disponible".
            aria-label={posible ? String(anio) : t("cdd.selectorYearRuledOut", { year: anio })}
            onClick={() => elegir(anio)}
          >
            {anio}
          </button>
        ))}
      </div>
    </>
  );
}
