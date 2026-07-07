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
  const { t, dateLocale } = useT();

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

  let statusAria;
  if (hasStreak && hasRank) statusAria = t("cdd.rankStreakAria", { streak, rank: rank.rank });
  else if (hasRank) statusAria = t("cdd.rankAria", { rank: rank.rank });
  else if (hasStreak) statusAria = t("cdd.streakAria", { streak });
  else statusAria = t("cdd.competeAria");

  return (
    <header className="prensa-area-cab">
      <nav className="prensa-topbar" aria-label={t("cdd.competeAria")}>
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
          <span className="sep" aria-hidden="true">·</span>
          <button
            type="button"
            aria-label={t("cdd.statsAria")}
            onClick={() => { haptic.impactLight(); onOpenRanking?.(); }}
          >
            {t("prensa.ranking")}
          </button>
        </span>
        <span>
          {showStatus ? (
            // Racha en oro viejo (lo acumulado); el puesto, si existe, al lado.
            // Abre el ranking, igual que la píldora de estado anterior.
            <button
              type="button"
              className={"racha" + (pop ? " animate-estampar" : "")}
              aria-label={statusAria}
              onClick={() => { haptic.impactLight(); onOpenRanking?.(); }}
            >
              {hasStreak && <>✦ {streak}</>}
              {hasStreak && hasRank && " · "}
              {hasRank && <>{rank.rank}º</>}
            </button>
          ) : (
            <button
              type="button"
              className="cta"
              aria-label={t("cdd.competeAria")}
              onClick={() => { haptic.impactLight(); onOpenRanking?.(); }}
            >
              {t("cdd.competeLabel")} →
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
        </span>
      </nav>

      <div className="prensa-masthead">
        {/* El h1 real (SEO/lectores) vive sr-only en Configurator; este es el
            wordmark visual del masthead. */}
        <p className="titulo">{t("app.title")}</p>
        <p className="lema">{t("prensa.lema")}</p>
      </div>

      <div className="prensa-folio">
        <span>{dateLabel}</span>
        <span aria-hidden="true">·</span>
        <span className="rojo">{t("prensa.folioEdicion")}</span>
      </div>
    </header>
  );
}
