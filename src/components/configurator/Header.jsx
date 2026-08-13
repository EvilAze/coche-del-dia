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

import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { esApp } from "../../lib/plataforma";
import { ordinal } from "../PuestoCifra";

export default function Header({
  rank = null, // { rank, total, delta } | null — puesto de temporada del logueado
  rankCargando = false, // aún no sabemos el puesto (≠ "no tiene puesto")
  user,
  repescaAlert = false,
  onOpenMenu,
  onOpenRanking,
}) {
  const { t, dateLocale, locale } = useT();

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
  // una vez, al abrirse). Al quitarlo, la cabecera se quedó sin ancla, y la
  // primera respuesta fue restar: se plegó el folio dentro de la barra, en
  // 9px y en gris. Eso arregló la jerarquía —ya no había tres rótulos del
  // mismo rango discutiendo— pero dejó la barra CORRECTA Y ANÓNIMA: cuatro
  // tamaños de letra en seis píxeles de rango (9, 10, 11 y el ordinal), o
  // sea, una barra de herramientas. Ningún salto de escala en toda la
  // cabecera; el único de la pantalla vivía abajo, en ADIVINAR.
  //
  // Y el dato más apagado era justo el único irrepetible: un juego DIARIO es
  // su edición, y la fecha iba a 9px en --cdd-muted al lado de un icono.
  //
  // Así que en la app el folio deja de ser una línea y pasa a ser una CIFRA,
  // el bloque de fecha de cualquier periódico: el día en Fraunces grande y,
  // apilados a su derecha, el mes y el día de la semana en microtipografía.
  // Es el ancla que se perdió con el masthead, pero SIN banda propia: el
  // bloque cabe dentro de los 34px que ya medía la marca del sumario, así que
  // la cabecera no engorda ni un píxel por esto.
  //
  // `formatToParts` y no tres `toLocaleDateString`: una sola pasada de Intl
  // que devuelve cada trozo etiquetado, así el orden lo decide la maqueta y no
  // una plantilla escrita a mano que se desalinearía en otro idioma. El punto
  // del mes abreviado ("ago.", según ICU) se cae aquí: una cifra de folio no
  // lleva puntuación.
  const enApp = esApp();
  const ahora = new Date();
  const rawDate = ahora.toLocaleDateString(dateLocale, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const dateLabel = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);
  const folio = enApp
    ? new Intl.DateTimeFormat(dateLocale, {
        weekday: "short", day: "numeric", month: "short",
      })
        .formatToParts(ahora)
        .reduce((acc, p) => {
          if (p.type === "day" || p.type === "month" || p.type === "weekday") {
            acc[p.type] = p.value.replace(/\.$/, "");
          }
          return acc;
        }, {})
    : null;

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
          {/* La cifra del folio, solo en la app. Va DESPUÉS de la marca y no
              centrada en la barra a propósito: centrarla la pondría a competir
              con la clasificación por el eje óptico, y en 360px además bailaría
              según lo largo que sea el mes. Agrupada a la izquierda, la barra
              se lee en dos bloques limpios — «qué ejemplar es» y «qué puedo
              hacer».

              La fecha larga viaja `sr-only`: partida en cifra y abreviaturas,
              un lector de pantalla diría «13 ago jue», que no es una fecha. Lo
              visual queda `aria-hidden` y quien escucha oye el folio entero,
              mejor de lo que lo oía antes. */}
          {folio && (
            <span className="prensa-folio-cifra">
              <span className="sr-only">{dateLabel}</span>
              <span className="dia" aria-hidden="true">{folio.day}</span>
              <span className="resto" aria-hidden="true">
                <span>{folio.month}</span>
                <span>{folio.weekday}</span>
              </span>
            </span>
          )}
        </span>

        {/* DERECHA: la clasificación. Con puesto, el ordinal en oro (mismo
            glifo que la tabla); sin él, la sección a secas. */}
        <span>
          <button
            type="button"
            className="prensa-clasif"
            aria-label={puesto != null ? t("cdd.rankAria", { rank: puesto }) : t("cdd.competeAria")}
            onClick={() => { haptic.impactLight(); onOpenRanking?.("cabecera"); }}
          >
            <span className="lad">{t("prensa.clasificacion")}</span>
            {/* Mientras no sabemos el puesto, una raya reserva su sitio: sin
                ella la palabra se desplazaba al llegar el dato. */}
            {rankCargando ? (
              <span className="pos pos--pendiente" aria-hidden="true">—</span>
            ) : puesto != null ? (
              <span className="pos">{ordinal(puesto, locale)}</span>
            ) : null}
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
