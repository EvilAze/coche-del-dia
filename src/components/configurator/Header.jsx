// src/components/configurator/Header.jsx
// Cabecera de periódico (rediseño «Prensa del motor»): topbar de enlaces en
// versalitas (GARAJE/RANKING a la izquierda; racha o CTA de competir + perfil
// a la derecha), masthead con el nombre del diario y su lema, y folio con la
// fecha completa entre filetes dobles. Sustituye a la barra de iconos del
// sistema Platino: en un periódico las secciones se NOMBRAN, no se iconizan —
// y de paso el texto es más descubrible que un glifo (auditoría UX previa).

import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { useTheme } from "../../lib/theme";
import { getCurrentSeason } from "../../lib/statsService";
import { rankMovement } from "../../lib/rankMovement";

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
  streak = 0,
  rank = null, // { rank, total } | null — puesto mensual del jugador logueado
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

  // Estampado breve cuando la racha SUBE (tras ganar). Solo en un incremento
  // real (4→5): el 0→N de la carga inicial no debe animar (parecería glitch).
  const prevStreak = useRef(streak);
  const [pop, setPop] = useState(false);
  useEffect(() => {
    if (streak > prevStreak.current && prevStreak.current > 0) {
      setPop(true);
      const id = setTimeout(() => setPop(false), 440);
      prevStreak.current = streak;
      return () => clearTimeout(id);
    }
    prevStreak.current = streak;
  }, [streak]);

  const hasStreak = streak > 0;
  const hasRank = Boolean(rank && rank.rank > 0);
  const showStatus = hasStreak || hasRank;

  // Movimiento del puesto vs ayer (misma lógica pura que el «parte» del final de
  // partida). Solo pintamos flecha en un cambio REAL de puesto: 'hold'/'new' no
  // llevan glifo (una flecha en 0 sería ruido). El delta ya viaja en el objeto
  // rank { rank, total, delta, isNew } desde getMySeasonRank — no pedimos nada.
  const rm = hasRank ? rankMovement(rank) : null;
  let mov = null;
  if (rm && rm.kind === "up") mov = { dir: "up", glyph: "▲", n: rm.n };
  else if (rm && rm.kind === "down") mov = { dir: "down", glyph: "▼", n: rm.n };

  let statusAria;
  if (hasStreak && hasRank) statusAria = t("cdd.rankStreakAria", { streak, rank: rank.rank });
  else if (hasRank) statusAria = t("cdd.rankAria", { rank: rank.rank });
  else if (hasStreak) statusAria = t("cdd.streakAria", { streak });
  else statusAria = t("cdd.competeAria");

  return (
    <header className="prensa-area-cab">
      <nav className="prensa-topbar" aria-label={t("cdd.competeAria")}>
        <span>
          {/* GARAJE queda como único ladillo de sección a la izquierda: el RANKING
              deja de ser un link de 10px aquí porque su palanca real —el puesto—
              sube a badge a la derecha (que ya abre el ranking al pulsar). Una sola
              puerta al ranking, más grande y descubrible, en vez de dos pequeñas. */}
          <button
            type="button"
            aria-label={repescaAlert ? t("cdd.garageRepescaAria") : t("cdd.garageAria")}
            onClick={() => { haptic.impactLight(); onOpenGarage?.(); }}
          >
            {t("prensa.garaje")}
            {/* Repesca pendiente: "(1)" rojo, como correcciones por publicar */}
            {repescaAlert && <span className="aviso" aria-hidden="true">(1)</span>}
          </button>
        </span>
        <span>
          {showStatus ? (
            // Badge de estado: el puesto (palanca #1 de retención) en oro viejo de
            // FILETE —nunca relleno, que se reserva a momentos premium— con su
            // movimiento vs ayer (▲/▼). Deja de camuflarse como texto de 10px y se
            // lee de un vistazo sin romper el masthead. Abre el ranking al pulsar.
            <button
              type="button"
              className={"estado" + (pop ? " animate-estampar" : "")}
              aria-label={statusAria}
              onClick={() => { haptic.impactLight(); onOpenRanking?.(); }}
            >
              {hasRank && <span className="pos">{rank.rank}º</span>}
              {hasRank && mov && (
                <span className={"mov mov--" + mov.dir} aria-hidden="true">{mov.glyph}{mov.n}</span>
              )}
              {hasRank && hasStreak && <span className="div" aria-hidden="true" />}
              {hasStreak && <span className="st">✦{streak}</span>}
            </button>
          ) : (
            // Jugador nuevo/anónimo sin puesto ni racha: el CTA de competir sube a
            // badge de filete ROJO —la única llamada de la barra— más visible que
            // el antiguo texto de 10px. Es al recién llegado a quien más importa
            // descubrir el ranking, así que aquí es donde más grita.
            <button
              type="button"
              className="estado estado--cta"
              aria-label={t("cdd.competeAria")}
              onClick={() => { haptic.impactLight(); onOpenRanking?.(); }}
            >
              <span className="txt">{t("cdd.competeLabel")} →</span>
            </button>
          )}
          <span className="sep" aria-hidden="true">·</span>
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
    </header>
  );
}
