// src/components/configurator/FajaClasificacion.jsx
// «La clasificación»: la faja de ranking bajo el folio de la portada.
//
// POR QUÉ EXISTE (y por qué no es otro enlace más de la barra):
// el ranking es la mayor palanca de retención del juego, pero vivía como una
// PALABRA dentro de la fila de navegación — y en una fila todos los elementos
// son iguales por construcción. La pasada anterior intentó destacarlo dentro de
// esa fila (cifra en oro, más cuerpo); es la palanca equivocada: no se puede
// hacer que un ítem domine una fila de pares sin romper la fila. Además el
// objetivo táctil eran ~50px pegados a otros tres enlaces, en el borde superior
// de la pantalla (la zona peor para el pulgar).
//
// La solución es ascenderlo de ENLACE a SECCIÓN. En un periódico la
// clasificación no es una entrada del sumario: es un recuadro con su ladillo y
// su cifra. Aquí eso da, del tirón, las dos cosas que faltaban — presencia
// (bloque con cifra a 38px en oro, no una palabra de 10px) y alcance (objetivo
// táctil de ancho completo, imposible de fallar).
//
// Deliberadamente comparte tipografía con el «parte de la clasificación» del
// final de partida (RankParte / .cdd-parte): son el MISMO objeto —tu puesto—
// en los dos momentos en que importa, al abrir el periódico y al cerrarlo.
//
// LA FAJA FINA: la portada se va con el scroll, y el jugador pasa la partida
// abajo, en el cupón. Cuando la faja grande sale de vista se queda pegada
// arriba una versión de una línea, al lado del «recorte» de la foto y con su
// mismo lenguaje (papel, filete, sombra): a la derecha lo que estás mirando, a
// la izquierda dónde vas. Nunca se solapan — el ancho máximo de la faja fina
// reserva el hueco del recorte.
//
// Si `IntersectionObserver` no existe, no hay faja fina y ya está: la grande
// sigue funcionando (regla 9, la home nunca se degrada a rota).

import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { rankMovement } from "../../lib/rankMovement";

export default function FajaClasificacion({ rank, cargando = false, onOpenRanking }) {
  const { t } = useT();
  const fajaRef = useRef(null);
  const [pegada, setPegada] = useState(false);

  useEffect(() => {
    const el = fajaRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    // `boundingClientRect.top < 0` distingue "se ha ido por arriba" de "aún no
    // ha entrado por abajo": sin eso la faja fina asomaría en el primer paint,
    // antes de que el usuario haya hecho scroll.
    const io = new IntersectionObserver(
      ([entrada]) => {
        setPegada(!entrada.isIntersecting && entrada.boundingClientRect.top < 0);
      },
      { threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const mv = rankMovement(rank);
  const rankeado = mv.kind !== "unranked";

  const abrir = (source) => {
    haptic.impactLight();
    onOpenRanking?.(source);
  };

  // Movimiento vs ayer, en telegrama. El «parte» del final de partida lo cuenta
  // en frase ("Hoy has subido 2 puestos") porque allí hay sitio y se está
  // celebrando; aquí es un dato al margen y va abreviado.
  let mov = null;
  if (mv.kind === "up") mov = { dir: "up", texto: `▲${mv.n} ${t("prensa.fajaAyer")}` };
  else if (mv.kind === "down") mov = { dir: "down", texto: `▼${mv.n} ${t("prensa.fajaAyer")}` };
  else if (mv.kind === "hold") mov = { dir: "hold", texto: t("prensa.fajaHold") };
  else if (mv.kind === "new") mov = { dir: "new", texto: t("prensa.fajaNueva") };

  // Mientras carga, el nombre accesible es el neutro de la sección: anunciar
  // "únete al ranking" a alguien que ya está dentro sería tan falso al oído
  // como la invitación lo es a la vista.
  const aria = cargando
    ? t("prensa.fajaLadillo")
    : rankeado
    ? t("cdd.rankAria", { rank: mv.pos })
    : t("cdd.competeAria");

  return (
    <>
      <button
        type="button"
        ref={fajaRef}
        className={"prensa-faja" + (!cargando && !rankeado ? " prensa-faja--invita" : "")}
        aria-label={aria}
        onClick={() => abrir("header_faja")}
      >
        <span className="faja-cab">
          <span className="lad">{t("prensa.fajaLadillo")}</span>
          {/* Filete que llena la línea, como en los ladillos de sección. Va
              como elemento propio y no como ::after porque aquí tiene que
              quedar ENTRE el ladillo y el "ver", no al final. */}
          <i className="filete" aria-hidden="true" />
          <span className="ver">
            {t("prensa.fajaVer")} <span aria-hidden="true">→</span>
          </span>
        </span>

        {cargando ? (
          // Aún no sabemos el puesto. Reservamos EXACTAMENTE el alto de la
          // cifra con una raya: sin esto, un jugador rankeado veía primero la
          // invitación de "gana hoy y entras en la tabla" —que además de ser
          // mentira mide la mitad— y la portada daba un salto al llegar el dato.
          <span className="faja-dato">
            <span className="pos pos--pendiente" aria-hidden="true">—</span>
          </span>
        ) : rankeado ? (
          <span className="faja-dato">
            <span className="pos">{mv.pos}º</span>
            {mv.total > 0 && (
              <span className="de">{t("parte.of", { total: mv.total })}</span>
            )}
            {mov && <span className={"mov mov--" + mov.dir}>{mov.texto}</span>}
          </span>
        ) : (
          // Sin puesto (anónimo o recién llegado): UNA línea de invitación, no
          // un bloque de cifras vacío. La meta se ofrece, no se impone — el
          // jugador casual de dos minutos no tiene por qué toparse con una
          // tabla antes de haber jugado.
          <span className="faja-invita">{t("prensa.fajaInvita")}</span>
        )}
      </button>

      {pegada && (
        <button
          type="button"
          className="prensa-faja-mini"
          aria-label={aria}
          onClick={() => abrir("header_faja_pegada")}
        >
          <span className="lad">{t("prensa.fajaLadilloCorto")}</span>
          {rankeado ? (
            <>
              <span className="pos">{mv.pos}º</span>
              {mov && (mv.kind === "up" || mv.kind === "down") && (
                <span className={"mov mov--" + mov.dir} aria-hidden="true">
                  {mv.kind === "up" ? "▲" : "▼"}
                  {mv.n}
                </span>
              )}
            </>
          ) : (
            <span className="ver">{t("prensa.fajaVer")}</span>
          )}
          <span className="chev" aria-hidden="true">›</span>
        </button>
      )}
    </>
  );
}
