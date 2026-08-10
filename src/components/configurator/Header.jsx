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
// La marca del sumario es un CUADRO DE FILETE con las tres reglas del índice, no
// la palabra «MENÚ» que había antes. El nombre era defendible cuando la barra
// tenía que competir consigo misma (una fila de cuatro secciones iguales), pero
// hoy la barra tiene dos elementos y el que importa es el de la derecha: gastar
// un tercio del ancho en repetir un glifo universal solo le quitaba aire al
// masthead. El área táctil real la agranda un pseudo-elemento (ver CSS): la caja
// mide 34px por diseño de portada, el dedo recibe 50.
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

  // Fecha COMPLETA con año: es la línea de folio de un periódico, no un pie
  // de barra — "Sábado, 5 de julio de 2026".
  const rawDate = new Date().toLocaleDateString(dateLocale, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const dateLabel = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);

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

      <div className="prensa-folio">
        <span>{dateLabel}</span>
      </div>

    </header>
  );
}
