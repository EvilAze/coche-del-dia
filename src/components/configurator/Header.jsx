// src/components/configurator/Header.jsx
// Cabecera de periódico (rediseño «Prensa del motor»): topbar con el SUMARIO
// desplegable a la izquierda (garaje, perfil, tema, reglas), la CLASIFICACIÓN a
// la derecha, masthead con el nombre del diario y folio con la fecha completa
// entre filetes dobles. Sustituye a la barra de iconos del sistema Platino: en
// un periódico las secciones se NOMBRAN, no se iconizan — y de paso el texto es
// más descubrible que un glifo (auditoría UX previa).
//
// La clasificación es lo ÚNICO que no se pliega dentro del sumario: es la
// palanca de retención del juego, y esconderla tras un toque extra la dejaría
// otra vez como «una palabra entre iguales». Cuando el jugador tiene puesto, la
// barra lo enseña con el mismo ordinal en oro (PuestoCifra) que la tabla — la
// firma de la sección, para que tocar y aterrizar se parezcan.

import { useEffect, useState, useRef } from "react";
import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { useTheme } from "../../lib/theme";
import { useEscape } from "../../hooks/useEscape";
import { ordinal } from "../PuestoCifra";

// Glifos del toggle de tema (mismo trazo 1.6 y caja 24 que los iconos del
// juego). Luna en día (invita a la noche); sol en noche (vuelve al día).
function MoonGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
function SunGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2v2.4M12 19.6V22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2 12h2.4M19.6 12H22M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" />
    </svg>
  );
}

export default function Header({
  rank = null, // { rank, total, delta } | null — puesto de temporada del logueado
  rankCargando = false, // aún no sabemos el puesto (≠ "no tiene puesto")
  user,
  repescaAlert = false,
  onOpenProfile,
  onOpenLogin,
  onOpenRanking,
  onOpenGarage,
  onOpenHowTo,
}) {
  const { t, dateLocale, locale } = useT();
  const { tema, toggle } = useTheme();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const botonRef = useRef(null);

  // Cerrar tocando fuera. `mousedown` y no `click`: en móvil el tap sobre otro
  // botón de la página debe cerrar el sumario ANTES de que ese botón actúe, o
  // el menú se quedaría abierto por encima de lo que se acaba de abrir.
  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  // Escape cierra y DEVUELVE EL FOCO al botón que lo abrió: sin eso, el foco de
  // teclado se quedaba en un elemento desmontado y el siguiente Tab arrancaba
  // desde el principio del documento.
  useEscape(menuOpen, () => {
    setMenuOpen(false);
    botonRef.current?.focus();
  });

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
        {/* IZQUIERDA: el SUMARIO. Garaje, perfil, tema y reglas se pliegan aquí
            para que la barra deje de ser una fila de cuatro iguales. */}
        <span className="relative" ref={menuRef}>
          <button
            type="button"
            ref={botonRef}
            // `aria-haspopup="true"` (genérico) y NO role="menu"/"menuitem": el
            // patrón `menu` de ARIA obliga a navegación con flechas, y aquí son
            // cuatro botones normales que se recorren con Tab. Anunciar un menú
            // que no responde a las flechas es peor que no anunciarlo.
            aria-haspopup="true"
            aria-expanded={menuOpen}
            aria-label={repescaAlert ? t("header.menuOpenWithRepesca") : t("header.menuOpen")}
            onClick={() => { haptic.impactLight(); setMenuOpen(!menuOpen); }}
            className={"prensa-menu-boton flex items-center group" + (menuOpen ? " abierto" : "")}
          >
            <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="mr-2 opacity-70 group-hover:opacity-100 transition-opacity" aria-hidden="true">
              <path d="M1 1h14M1 6h14M1 11h14" />
            </svg>
            {t("header.menuTitle")}
            {/* Repesca pendiente: "(1)" rojo, como correcciones por publicar.
                Se repite dentro, en el Garaje, porque plegado el sumario no
                dice DÓNDE está la corrección. */}
            {repescaAlert && <span className="aviso" aria-hidden="true">(1)</span>}
          </button>

          {menuOpen && (
            // El SUMARIO, con la anatomía de un sumario de periódico: ladillo,
            // filete y entradas. Va en DOS grupos separados por doble filete
            // porque no son lo mismo — arriba las SECCIONES a las que se
            // navega (archivo, perfil), abajo los SERVICIOS del ejemplar (cómo
            // se lee, en qué tinta se imprime). Cuatro renglones idénticos en
            // fila era justo lo que hacía que la caja no dijera nada.
            <div className="prensa-menu">
              {/* Ladillo decorativo: el <nav> ya se llama «Secciones» para el
                  lector de pantalla, así que aquí sobra repetirlo en voz. */}
              <p className="prensa-menu-lad" aria-hidden="true">{t("prensa.navAria")}</p>

              <div className="prensa-menu-grupo">
                <button
                  type="button"
                  onClick={() => { haptic.impactLight(); setMenuOpen(false); onOpenGarage?.(); }}
                >
                  <span>{t("prensa.garaje")}</span>
                  {repescaAlert && <span className="aviso" aria-hidden="true">(1)</span>}
                </button>

                <button
                  type="button"
                  onClick={() => { haptic.impactLight(); setMenuOpen(false); (user ? onOpenProfile : onOpenLogin)?.(); }}
                >
                  <span>{user ? t("prensa.perfil") : t("prensa.entrar")}</span>
                </button>
              </div>

              <div className="prensa-menu-grupo">
                <button
                  type="button"
                  onClick={() => { haptic.impactLight(); setMenuOpen(false); onOpenHowTo?.(); }}
                >
                  <span>{t("cdd.helpAria")}</span>
                </button>

                <button
                  type="button"
                  aria-pressed={tema === "noche"}
                  onClick={() => { haptic.impactLight(); setMenuOpen(false); toggle(); }}
                >
                  <span>{tema === "noche" ? t("cdd.themeToDay") : t("cdd.themeToNight")}</span>
                  {tema === "noche" ? <SunGlyph /> : <MoonGlyph />}
                </button>

                {/* La privacidad vive AQUÍ y no solo en el pie por lo que pasa
                    en la app: allí el pliego no scrollea (shell fijo) y el pie
                    queda fuera de la pantalla, así que un enlace que solo
                    existiera abajo sería inalcanzable — y Play exige que la
                    política sea accesible desde dentro de la app. En web se
                    queda en los dos sitios, igual que «Cómo se juega», que ya
                    estaba duplicado entre este sumario y el pie. */}
                <a href="/privacidad" onClick={() => haptic.impactLight()}>
                  <span>{t("app.footerPrivacy")}</span>
                </a>
              </div>
            </div>
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

      <div className="prensa-folio">
        <span>{dateLabel}</span>
      </div>

    </header>
  );
}
