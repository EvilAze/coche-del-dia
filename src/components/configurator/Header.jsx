// src/components/configurator/Header.jsx
// Cabecera de periódico (rediseño «Prensa del motor»): topbar con la MARCA DEL
// SUMARIO a la izquierda (abre el índice del ejemplar) y la CLASIFICACIÓN a la
// derecha, masthead con el nombre del diario y folio con la fecha completa entre
// filetes dobles.
//
// EL SUMARIO YA NO CUELGA DE AQUÍ. Hasta ahora este archivo montaba, además de
// la barra, un desplegable propio con las cinco entradas del menú y toda su
// mecánica (estado abierto/cerrado, cierre al tocar fuera, Escape con devolución
// de foco). Ese panel es hoy un modal centrado —SumarioModal, en el slot de
// overlays de App.jsx— por las razones que documenta ese archivo; aquí solo
// queda el botón que lo llama, así que la cabecera vuelve a ser lo que dice ser:
// una cabecera. De paso desaparecen tres mecanismos duplicados: el foco, el
// scrim y el «atrás» de Android los resuelve ya ModalShell para todos los
// modales del juego.
//
// La marca del sumario son las tres reglas del índice, no la palabra «MENÚ» que
// había antes. El nombre era defendible cuando la barra tenía que competir
// consigo misma (una fila de cuatro secciones iguales), pero hoy la barra tiene
// dos elementos y el que importa es el de la derecha: gastar un tercio del ancho
// en repetir un glifo universal solo le quitaba aire al masthead. El área táctil
// real la agranda un pseudo-elemento (ver CSS): la caja mide 34px por diseño de
// portada, el dedo recibe 50.
//
// EN LA APP ESA CAJA NO LLEVA MARCO, y no es un capricho: el filete de 1px en
// --line-strong es exactamente lo que dibuja `.cdd-stage-frame` alrededor de la
// fotografía. En este sistema un marco de filete significa «esto es una lámina,
// algo que se mira»; el botón del menú no es eso, es una marca de navegación.
// Enmarcado, además, resultaba el objeto MÁS claro de una cabecera hecha de
// susurros de 9 y 10px (en la edición de noche, --line-strong es lo siguiente
// más brillante después de la propia foto). Se queda la geometría —34px, área
// táctil de 50, esquina superior izquierda— y se va el marco. En web sigue
// enmarcada: allí la barra cuelga de un masthead que la subordina.
//
// La clasificación es lo ÚNICO que no se pliega dentro del sumario: es la
// palanca de retención del juego, y esconderla tras un toque extra la dejaría
// otra vez como «una palabra entre iguales». Cuando el jugador tiene puesto, la
// barra lo enseña con el mismo ordinal en oro (PuestoCifra) que la tabla — la
// firma de la sección, para que tocar y aterrizar se parezcan. Dentro del
// sumario aparece TAMBIÉN como portadilla: un índice que no lista la sección
// principal se lee incompleto.
//
// ── LA BARRA DE LA APP TENÍA LA JERARQUÍA DEL REVÉS ───────────────────────────
// Lo más grande y más brillante era la FECHA (24px, tinta plena): el único dato
// de la barra que no se puede tocar, que cambia solo y que el reloj del sistema
// ya insinúa dos centímetros más arriba. La clasificación —lo único accionable,
// y la palanca de retorno del juego— iba a 13px. El ojo aterrizaba en el «13» y
// no llegaba nunca al «12º».
//
// Y la derecha era todo etiqueta y nada cifra: «CLASIFICACIÓN» son catorce
// caracteres, más de un tercio del ancho de la barra, para un valor de tres. En
// un marcador el número es el mensaje y la palabra es el pie. Por eso agrandar
// el ordinal a secas no habría bastado: los dos seguirían compitiendo.
//
// Se cambian de sitio los pesos, no las piezas:
//
//   · LA CLASIFICACIÓN pasa a ser el objeto que ya usa el resto del juego —
//     etiqueta microscópica arriba, cifra debajo—, con el ordinal a 22px. Es el
//     mismo glifo de PuestoCifra que la tabla y el parte final, así que tocar y
//     aterrizar se siguen pareciendo, solo que ahora se ve.
//
//   · EL MOVIMIENTO DEL DÍA se pinta al lado del ordinal cuando lo hay. Es lo
//     que convierte el puesto de dato fijo en noticia: sin él, la cifra dice lo
//     mismo el lunes que el jueves. Sale del mismo `rankMovement` que el parte
//     del final de partida, así que la cabecera y el cierre cuentan la misma
//     historia. Solo se pinta con movimiento REAL (subes/bajas): si mantienes o
//     estrenas temporada no hay chip, y así su sola presencia ya significa que
//     ha pasado algo. Va en TINTA con una flecha de línea, nunca en verde o
//     rojo: esos dos colores son el veredicto de los intentos («acertado»,
//     «fallado») y aquí dirían otra cosa.
//
//   · LA FECHA baja a cornisa. Ver el bloque del folio, más abajo.
//
// Todo esto es de la APP. En web la barra cuelga del masthead y de la banda del
// folio, no es lo primero que se lee, y el problema que se arregla aquí allí no
// existe: la maqueta de escritorio no cambia ni un píxel.

import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { esApp } from "../../lib/plataforma";
import { rankMovement } from "../../lib/rankMovement";
import { ordinal } from "../PuestoCifra";

export default function Header({
  rank = null, // { rank, total, delta } | null — puesto de temporada del logueado
  rankCargando = false, // aún no sabemos el puesto (≠ "no tiene puesto")
  user,
  repescaAlert = false,
  onOpenMenu,
  onOpenRanking,
}) {
  const { t, tn, dateLocale, locale } = useT();

  // El puesto solo se enseña con cuenta real: un anónimo no tiene fila en la
  // tabla, así que la barra le ofrece la sección a secas.
  const puesto = user && rank ? rank.rank : null;

  // ── EL FOLIO TIENE DOS FORMAS, UNA POR PLATAFORMA ─────────────────────────
  // En WEB sigue siendo la línea de folio de siempre: fecha COMPLETA con año
  // ("Sábado, 5 de julio de 2026"), centrada entre filetes dobles bajo el
  // masthead. Ahí hay ancla —el masthead— y el folio se lee como lo que es, el
  // número de la edición colgando del cabecero.
  //
  // En la APP no hay masthead (se oculta en index.css: una app dice su nombre
  // una vez, al abrirse). Al quitarlo, la cabecera se quedó sin ancla, y por
  // ahí pasó primero una línea de 9px en gris (correcta y anónima) y después
  // una CIFRA de calendario: el día a 24px con el mes y el día de la semana
  // apilados en microtipografía a su derecha.
  //
  // La cifra arregló lo de la letra apagada y creó dos problemas nuevos. Uno,
  // que se llevó el mayor peso de la barra el dato que menos se puede hacer
  // con él (ver la cabecera de este archivo). Y dos, que ese bloque no era
  // prensa sino el icono de calendario de iOS: un número grande con dos
  // renglones de 9px apilados al lado. Apilaba, además, para poder meter el
  // día de la semana, que es el dato más prescindible de la pantalla — en un
  // juego diario nadie necesita saber que es jueves. Quitado «JUE», la columna
  // se queda sin motivo para existir.
  //
  // AHORA ES UNA CORNISA, que es como se llama en tipografía el rótulo que en
  // las páginas interiores dice qué diario y qué día estás leyendo: el nombre
  // en versalitas diminutas y, debajo, la fecha en Fraunces. Eso responde de
  // paso a la objeción de «una app dice su nombre una vez»: una cornisa no es
  // el nombre presentándose otra vez, es la página identificándose. Y le
  // devuelve a la izquierda de la barra un motivo para existir más allá de
  // «hoy es 13».
  //
  // NO ENGORDA LA BARRA, que sigue siendo la condición: 8,5px de cornisa + 3
  // de aire + 15 de fecha = 26,5px, holgados dentro de los 34px que fija la
  // marca del sumario. Con el mes más largo («13 de septiembre») el bloque
  // mide ~150px de los ~324 disponibles, y el de la clasificación ~90: no hay
  // riesgo de que se toquen ni en un móvil de 360.
  //
  // Un solo `toLocaleDateString` con día y mes: el orden lo pone Intl, que en
  // es-ES da «13 de agosto» y en en-US «August 13». La fecha COMPLETA sigue
  // viajando en `sr-only`, así que quien escucha oye el folio entero.
  const enApp = esApp();
  const ahora = new Date();
  const rawDate = ahora.toLocaleDateString(dateLocale, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const dateLabel = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);
  const fechaCorta = enApp
    ? ahora.toLocaleDateString(dateLocale, { day: "numeric", month: "long" })
    : null;

  // El movimiento del día, solo en la app y solo cuando de verdad lo hay: con
  // `hold` (mantienes) o `new` (estrenas) no se pinta nada. `rankMovement`
  // devuelve `n` siempre positivo y el sentido en `kind`.
  const mov = enApp && user && rank ? rankMovement(rank) : null;
  const salto = mov && (mov.kind === "up" || mov.kind === "down") ? mov : null;

  // El aria del botón cuenta lo mismo que se ve: puesto y, si lo hay, el
  // movimiento — con las MISMAS cadenas que el parte del final de partida, que
  // ya están traducidas y pluralizadas.
  const clasifAria = [
    puesto != null ? t("cdd.rankAria", { rank: puesto }) : t("cdd.competeAria"),
    salto ? tn(`parte.${salto.kind}`, salto.n) : null,
  ]
    .filter(Boolean)
    .join(". ");

  // Qué ocupa el hueco de la cifra, en orden de precedencia. Se calcula fuera
  // del JSX para que el caso «nada» sea explícito: en WEB sin puesto no se
  // monta el contenedor y la barra queda exactamente como estaba.
  const cifra = rankCargando ? (
    // Mientras no sabemos el puesto, una raya reserva su sitio: sin ella la
    // palabra se desplazaba al llegar el dato.
    <span className="pos pos--pendiente" aria-hidden="true">—</span>
  ) : puesto != null ? (
    <>
      <span className="pos">{ordinal(puesto, locale)}</span>
      {/* El chip solo existe cuando hay salto, así que su presencia ya es el
          mensaje. `aria-hidden` porque el movimiento ya va dicho, y mejor, en
          el aria-label del botón. */}
      {salto && (
        <span className={"mov mov--" + salto.kind} aria-hidden="true">
          {/* Una sola flecha para los dos sentidos: bajar es esta misma
              volteada desde el CSS (`.mov--down svg`), así no hay dos trazos
              que mantener en sync. */}
          <svg width="11" height="7" viewBox="0 0 11 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1.4 5.6 5.5 1.4l4.1 4.2" />
          </svg>
          {salto.n}
        </span>
      )}
    </>
  ) : enApp ? (
    // Sin puesto (anónimo, o logueado que aún no ha ganado esta temporada) el
    // hueco lo ocupa la invitación, en ROJO: es acción, no valor, y el oro no
    // puede prometer un puesto que no existe. Hace falta porque en la app la
    // etiqueta se apila SOBRE la cifra, y sola se quedaba como un renglón de
    // 8,5px flotando en una barra de 34. En web la etiqueta va en línea y a su
    // tamaño de siempre, así que allí no sobra nada y no se añade.
    <span className="pos pos--invita">{t("prensa.competir")}</span>
  ) : null;

  return (
    <header className="prensa-area-cab">
      {/* `aria-label` de navegación a secas: el reclamo («únete al ranking»)
          vive en el propio botón de la clasificación, que es quien lo cumple. */}
      <nav className="prensa-topbar" aria-label={t("prensa.navAria")}>
        {/* IZQUIERDA: la marca del sumario. */}
        <span>
          <button
            type="button"
            // `aria-haspopup="dialog"` y sin `aria-expanded`: lo que abre es un
            // diálogo modal que se anuncia solo al recibir el foco, no un menú
            // desplegado dentro de la barra. Anunciar "expandido" sobre algo que
            // ya no vive aquí sería mentirle al lector de pantalla.
            aria-haspopup="dialog"
            aria-label={repescaAlert ? t("header.menuOpenWithRepesca") : t("header.menuOpen")}
            onClick={() => { haptic.impactLight(); onOpenMenu?.(); }}
            className="prensa-sumario-boton"
          >
            <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M1 1h14M1 6h14M1 11h14" />
            </svg>
            {/* Repesca pendiente: cuadradito de tinta roja en la esquina, como
                la marca del corrector. Plegado el sumario, el "(1)" con el
                nombre de la sección se repite dentro, en la portadilla del
                Archivo — aquí fuera solo cabe el aviso de que hay algo. */}
            {repescaAlert && <span className="aviso" aria-hidden="true" />}
          </button>
          {/* La cornisa, solo en la app. Va DESPUÉS de la marca y no centrada
              en la barra a propósito: centrarla la pondría a competir con la
              clasificación por el eje óptico, y en 360px además bailaría según
              lo largo que sea el mes. Agrupada a la izquierda, la barra se lee
              en dos bloques limpios — «qué ejemplar es» y «qué puedo hacer».

              La fecha larga viaja `sr-only` y lo visual va `aria-hidden`: quien
              escucha oye «Jueves, 13 de agosto de 2026» en vez de una fecha sin
              año, y no se le repite el nombre de la app en cada pantalla. */}
          {fechaCorta && (
            <span className="prensa-cornisa">
              <span className="sr-only">{dateLabel}</span>
              <span className="cabeza" aria-hidden="true">{t("app.title")}</span>
              <span className="fecha" aria-hidden="true">{fechaCorta}</span>
            </span>
          )}
        </span>

        {/* DERECHA: la clasificación. Con puesto, el ordinal en oro (mismo
            glifo que la tabla) y su movimiento del día; sin él, la invitación
            a competir. */}
        <span>
          <button
            type="button"
            className="prensa-clasif"
            aria-label={clasifAria}
            onClick={() => { haptic.impactLight(); onOpenRanking?.("cabecera"); }}
          >
            <span className="lad">{t("prensa.clasificacion")}</span>
            {/* La cifra y su movimiento van juntos en un contenedor propio para
                que en la app puedan apilarse BAJO la etiqueta sin que el chip
                se despegue del ordinal. En web este envoltorio es transparente:
                la barra sigue siendo una fila de etiqueta + cifra. Y cuando no
                hay nada que meter dentro NO se monta, porque un hijo vacío en un
                flex con `gap` deja 7px de aire colgando tras la palabra. */}
            {cifra && <span className="cifra">{cifra}</span>}
          </button>
        </span>
      </nav>

      <div className="prensa-masthead prensa-masthead--compacto">
        {/* El h1 real (SEO/lectores) vive sr-only en Configurator; este es el
            wordmark visual del masthead. */}
        <p className="titulo">{t("app.title")}</p>
      </div>

      {/* La banda del folio es cosa de la WEB. En la app la fecha ya viaja en
          la barra de arriba, y montarla también aquí sería decir la misma cosa
          dos veces —y, peor, repetírsela a quien use lector de pantalla—. Con
          esta banda se van sus DOS filetes dobles, que era el otro problema:
          el filete doble significa «división mayor» y había dos seguidos en un
          palmo (más el de la barra y el del ladillo, cuatro reglas en 40px).
          Ahora queda UNO, bajo la barra, justo donde separa la navegación del
          ejemplar. */}
      {!enApp && (
        <div className="prensa-folio">
          <span>{dateLabel}</span>
        </div>
      )}

    </header>
  );
}
