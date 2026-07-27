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

import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { useTheme } from "../../lib/theme";
import { getCurrentSeason } from "../../lib/statsService";
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
  user,
  repescaAlert = false,
  onOpenProfile,
  onOpenLogin,
  onOpenRanking,
  onOpenGarage,
}) {
  const { t, dateLocale, locale } = useT();
  const { tema, toggle } = useTheme();

  // Temporada activa para el subtítulo del masthead ("Temporada N · Tema"). Lectura
  // pública barata; NO bloquea el primer paint — el masthead aparece y la línea se
  // añade al resolver. null = sin temporada activa → no se pinta (sin salto brusco).
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

  // Portada completa (con lema) SOLO en la primera visita: el jugador RECURRENTE
  // ve un masthead compacto para que la foto y el cupón entren en pantalla sin
  // hacer scroll (la portada íntegra era un peaje vertical repetido cada día).
  // Lectura SÍNCRONA de localStorage en el initializer para decidir bien en el
  // primer paint —si esperásemos a un useEffect, el lema aparecería/desaparecería
  // de golpe (CLS)—. Fail-open a la portada completa si localStorage no está
  // (modo privado / webview efímero): regla 9, la home nunca se degrada a roto.
  const [portadaCompleta] = useState(() => {
    try {
      return !localStorage.getItem("ccd_masthead_seen");
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("ccd_masthead_seen", "1");
    } catch {
      // localStorage puede fallar (modo privado/iframe): sin marca, sin drama —
      // el visitante seguirá viendo la portada completa, que es el fallback bueno.
    }
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
        <span>
          <button
            type="button"
            aria-label={repescaAlert ? t("cdd.garageRepescaAria") : t("cdd.garageAria")}
            onClick={() => { haptic.impactLight(); onOpenGarage?.(); }}
          >
            {t("prensa.garaje")}
            {/* Repesca pendiente: "(1)" rojo, como correcciones por publicar */}
            {repescaAlert && <span className="aviso" aria-hidden="true">(1)</span>}
          </button>
          {/* RANKING ya no vive aquí: ascendió de enlace a SECCIÓN y es la faja
              de más abajo. Mantenerlo además en esta fila sería un segundo
              acceso al mismo destino compitiendo con el primero — y lo que le
              faltaba al ranking no era otra puerta, era dejar de ser una
              palabra entre iguales. La barra se queda con lo secundario, que es
              justo lo que la hace callar para que hable la faja. */}
        </span>
        <span>
          <button
            type="button"
            aria-label={t("cdd.profileAria")}
            onClick={() => { haptic.impactLight(); (user ? onOpenProfile : onOpenLogin)?.(); }}
          >
            {user ? t("prensa.perfil") : t("prensa.entrar")}
          </button>
          <span className="sep" aria-hidden="true">·</span>
          <button
            type="button"
            className="prensa-tema"
            aria-pressed={tema === "noche"}
            aria-label={tema === "noche" ? t("cdd.themeToDay") : t("cdd.themeToNight")}
            onClick={() => { haptic.impactLight(); toggle(); }}
          >
            {tema === "noche" ? <SunGlyph /> : <MoonGlyph />}
          </button>
        </span>
      </nav>

      <div className={"prensa-masthead" + (portadaCompleta ? "" : " prensa-masthead--compacto")}>
        {/* El h1 real (SEO/lectores) vive sr-only en Configurator; este es el
            wordmark visual del masthead. */}
        <p className="titulo">{t("app.title")}</p>
        {/* El lema es voz de marca de "portada": se pinta en la primera visita y
            se retira para el recurrente (gana altura sobre el fold). El título y
            el folio (identidad + fecha) se quedan siempre. */}
        {portadaCompleta && <p className="lema">{t("prensa.lema")}</p>}
        {/* Temporada temática en curso: sello dorado que señala de un vistazo que
            el juego va por temporadas y en cuál estamos. Solo si hay una activa. */}
        {season && (
          <p className="temporada">
            {t("prensa.temporada", {
              tema: locale === "en" ? season.label_en : season.label_es,
            })}
          </p>
        )}
      </div>

      <div className="prensa-folio">
        <span>{dateLabel}</span>
        <span aria-hidden="true">·</span>
        <span className="rojo">{t("prensa.folioEdicion")}</span>
      </div>

      {/* La clasificación cierra la portada: es lo último que se lee antes de
          la foto del día, en el sitio donde un periódico pone su recuadro de
          resultados. Se monta SIEMPRE — con puesto muestra la cifra; sin él,
          una línea de invitación. */}
      <FajaClasificacion
        rank={rank}
        cargando={rankCargando}
        onOpenRanking={onOpenRanking}
      />
    </header>
  );
}
