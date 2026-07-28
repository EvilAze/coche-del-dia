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
// Comparte el marcador de puesto (PuestoCifra) con el parte del final de
// partida, la faja fina y el modal: es el MISMO objeto —tu puesto— en todos los
// momentos en que importa, y por eso se dibuja siempre igual.
//
// LAS TRES LÍNEAS:
//   1. ladillo + «ver →»            (qué sección es y que se puede tocar)
//   2. tu puesto + movimiento        (dónde estás)
//   3. distancia al de arriba + cierre de temporada  (qué puedes hacer hoy)
// La tercera es la que convierte el dato en objetivo: un puesto es un hecho
// consumado, «a 3 puntos del 6º» es una tarde de juego. Si la base de datos aún
// no tiene la migración de la distancia (scripts/2026-07-clasificacion-distancia.sql)
// `gap` llega null y la línea simplemente no se pinta.
//
// LA FAJA FINA: la portada se va con el scroll, y el jugador pasa la partida
// abajo, en el cupón. Cuando la faja grande sale de vista se queda pegada una
// versión de una línea, con el mismo lenguaje (papel, filete, sombra). MIENTRAS
// SE JUEGA vive arriba, junto al «recorte» de la foto (a la derecha lo que
// miras, a la izquierda dónde vas, y nunca se solapan porque el ancho máximo
// reserva el hueco). ACABADA LA PARTIDA baja al borde inferior: ya no hay cupón
// que escribir ni teclado que esquivar, y ahí es donde está el pulgar.
//
// Si `IntersectionObserver` no existe, no hay faja fina y ya está: la grande
// sigue funcionando (regla 9, la home nunca se degrada a rota).

import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { rankMovement } from "../../lib/rankMovement";
import { daysUntilClose } from "../../lib/season";
import { getCurrentSeason } from "../../lib/statsService";
import PuestoCifra, { ordinal } from "../PuestoCifra";

export default function FajaClasificacion({
  rank,
  cargando = false,
  // Partida cerrada: la faja fina se muda al borde inferior (ver cabecera).
  partidaCerrada = false,
  onOpenRanking,
}) {
  const { t, tn, locale } = useT();
  const fajaRef = useRef(null);
  const [pegada, setPegada] = useState(false);

  // Temporada activa solo para el «cierra en N días». `getCurrentSeason` está
  // memoizada por día en statsService, así que compartimos la petición con el
  // masthead y el parte en vez de abrir una cuarta. Sin temporada → sin línea.
  const [season, setSeason] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getCurrentSeason()
      .then((s) => {
        if (!cancelled) setSeason(s);
      })
      .catch(() => {
        if (!cancelled) setSeason(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // La distancia al de arriba. Tres casos, en orden de "qué le digo hoy":
  //   líder      → no hay nadie delante, se le dice que lo defienda
  //   empatado   → mismos puntos, les separa el desempate (última victoria)
  //   a N puntos → el caso normal, y el único que da un objetivo numérico
  let distancia = null;
  if (rankeado) {
    // El puesto de arriba, escrito como ordinal del idioma activo («6º» / «6th»).
    const arriba = ordinal(mv.pos - 1, locale);
    if (mv.pos === 1) distancia = t("prensa.fajaLider");
    else if (rank?.gap === 0) distancia = t("prensa.fajaEmpate", { pos: arriba });
    else if (rank?.gap > 0)
      distancia = tn("prensa.fajaDistancia", rank.gap, { pos: arriba });
  }

  // Cierre de temporada: urgencia en tres palabras. Solo desde el último tramo
  // —con 12 días por delante no es una noticia, es ruido— y siempre que haya
  // temporada activa.
  const dias = season ? daysUntilClose(season.ends_at) : null;
  const cierre =
    dias == null || dias > 3
      ? null
      : dias <= 0
      ? t("prensa.fajaCierraHoy")
      : tn("prensa.fajaCierra", dias);

  // El pie de la faja: distancia y cierre en una sola línea, separados por el
  // punto medio de siempre. Cualquiera de los dos puede faltar.
  const pie = [distancia, cierre].filter(Boolean).join(" · ");

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
            <PuestoCifra pos={mv.pos} total={mv.total} size="xl" />
            {mov && <span className={"mov mov--" + mov.dir}>{mov.texto}</span>}
          </span>
        ) : (
          // Sin puesto (anónimo o recién llegado): UNA línea de invitación, no
          // un bloque de cifras vacío. La meta se ofrece, no se impone — el
          // jugador casual de dos minutos no tiene por qué toparse con una
          // tabla antes de haber jugado.
          <span className="faja-invita">{t("prensa.fajaInvita")}</span>
        )}

        {/* La línea de abajo solo aparece cuando tiene algo que decir: al que
            aún no compite no se le habla de distancias. */}
        {!cargando && pie && <span className="faja-pie">{pie}</span>}
      </button>

      {pegada && (
        <button
          type="button"
          className={
            "prensa-faja-mini" + (partidaCerrada ? " prensa-faja-mini--pie" : "")
          }
          aria-label={aria}
          onClick={() => abrir("header_faja_pegada")}
        >
          <span className="lad">{t("prensa.fajaLadilloCorto")}</span>
          {rankeado ? (
            <>
              {/* El MISMO marcador que la faja grande, a cuerpo pequeño: es lo
                  que hace que la pieza pegada se lea como la de arriba y no
                  como otro botón cualquiera. */}
              <PuestoCifra pos={mv.pos} size="s" />
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
