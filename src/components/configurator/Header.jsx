// src/components/configurator/Header.jsx
// Cabecera de periódico (rediseño «Prensa del motor»): topbar de enlaces en
// versalitas (archivo a la izquierda; perfil y tema a la derecha), masthead con
// el nombre del diario y su lema, folio con la fecha completa entre filetes
// dobles y, cerrando la portada, la FAJA DE CLASIFICACIÓN. Sustituye a la barra
// de iconos del sistema Platino: en un periódico las secciones se NOMBRAN, no
// se iconizan — y de paso el texto es más descubrible que un glifo (auditoría
// UX previa).
//
// El ranking NO está en la topbar: era una palabra entre iguales y ahora es una
// sección con su propio bloque (ver FajaClasificacion.jsx). La barra se queda
// con lo secundario a propósito.

import { useEffect, useState, useRef } from "react";
import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { useTheme } from "../../lib/theme";
import FajaClasificacion from "./FajaClasificacion";

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
  // Partida cerrada: la faja fina se muda al pie (ver FajaClasificacion).
  partidaCerrada = false,
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

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fecha COMPLETA con año: es la línea de folio de un periódico, no un pie
  // de barra — "Sábado, 5 de julio de 2026".
  const rawDate = new Date().toLocaleDateString(dateLocale, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const dateLabel = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);

  return (
    <header className="prensa-area-cab">
      {/* El aria-label ya no puede ser «únete al ranking»: esa era la promesa de
          la barra cuando el ranking vivía en ella. Ahora es navegación a secas. */}
      <nav className="prensa-topbar" aria-label={t("prensa.navAria")}>
        {/* IZQUIERDA: Menú desplegable con Archivo, Perfil, etc. */}
        <span className="relative" ref={menuRef}>
          <button
            type="button"
            aria-expanded={menuOpen}
            onClick={() => { haptic.impactLight(); setMenuOpen(!menuOpen); }}
          >
            {t("header.menuTitle").toUpperCase()}
            {repescaAlert && <span className="aviso" aria-hidden="true">(1)</span>}
          </button>
          
          {menuOpen && (
            <div className="absolute top-full left-0 mt-2 min-w-max bg-papel-mat border border-border-strong shadow-glass-lg z-50 py-2 flex flex-col items-start prensa-menu-dropdown">
              <button
                type="button"
                className="w-full text-left px-5 py-4 text-[11px] hover:text-rojo hover:bg-papel-2 transition-colors flex items-center justify-between gap-4"
                onClick={() => { haptic.impactLight(); setMenuOpen(false); onOpenGarage?.(); }}
              >
                <span>{t("prensa.garaje")}</span>
                {repescaAlert && <span className="text-rojo font-bold">(1)</span>}
              </button>
              
              <button
                type="button"
                className="w-full text-left px-5 py-4 text-[11px] hover:text-rojo hover:bg-papel-2 transition-colors"
                onClick={() => { haptic.impactLight(); setMenuOpen(false); (user ? onOpenProfile : onOpenLogin)?.(); }}
              >
                {user ? t("prensa.perfil") : t("prensa.entrar")}
              </button>
              
              <button
                type="button"
                className="w-full text-left px-5 py-4 text-[11px] hover:text-rojo hover:bg-papel-2 transition-colors flex items-center justify-between gap-4"
                onClick={() => { haptic.impactLight(); setMenuOpen(false); toggle(); }}
              >
                <span>{tema === "noche" ? t("cdd.themeToDay") : t("cdd.themeToNight")}</span>
                {tema === "noche" ? <SunGlyph /> : <MoonGlyph />}
              </button>

              <button
                type="button"
                className="w-full text-left px-5 py-4 text-[11px] hover:text-rojo hover:bg-papel-2 transition-colors"
                onClick={() => { haptic.impactLight(); setMenuOpen(false); onOpenHowTo?.(); }}
              >
                {t("cdd.helpAria", "CÓMO SE JUEGA")}
              </button>
            </div>
          )}
        </span>
        
        {/* DERECHA: Clasificación / Puesto del jugador */}
        <span>
          <button
            type="button"
            className="text-gold font-bold hover:text-rojo transition-colors"
            onClick={() => { haptic.impactLight(); onOpenRanking?.(); }}
          >
            {user && rank ? (
              <span>🏆 PUESTO #{rank.rank}</span>
            ) : rankCargando ? (
              <span>...</span>
            ) : (
              <span>CLASIFICACIÓN</span>
            )}
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
