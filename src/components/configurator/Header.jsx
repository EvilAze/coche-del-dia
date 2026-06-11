// src/components/configurator/Header.jsx
// Cabecera del configurador: wordmark CDD + fecha (izq.) y, a la derecha, la
// PÍLDORA DE ESTADO (racha + puesto en el ranking) como elemento héroe, seguida
// de las utilidades en gris (garaje, perfil). Tres elementos a la derecha y
// nada más: la barra debe caber holgada en móvil (≤360px) sin desbordar.
//
// Jerarquía visual (auditoría UX, dir. Platino): el ranking deja de ser un
// icono mudo entre tres iguales y asciende a ESTADO VIVO — la píldora muestra el
// puesto del jugador (🏆#42). El número es el gancho de retención del juego
// diario ("voy 42º"), no una pantalla que abrir; por eso vive en la barra.
//
// El "?" de ayuda y el subtítulo del juego NO viven aquí: ocupaban demasiado y
// desbordaban la fila. El subtítulo sobrevive sr-only (Configurator) y el "?"
// vuelve solo en la primera visita, dentro de la intro de onboarding que pinta
// Configurator — la barra del día a día queda limpia.

import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { Icon, I } from "./icons";

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

  const dateLabel = new Date()
    .toLocaleDateString(dateLocale, { weekday: "long", day: "numeric", month: "long" })
    .toUpperCase();

  // Pop de la racha cuando SUBE (tras ganar): un latido breve que celebra el
  // incremento sin ser estridente. Solo en un incremento REAL (p.ej. 4→5): el
  // 0→N de la carga inicial / login no debe latir (parecería un glitch).
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

  // Qué puede mostrar la píldora. rank = { rank, total } | null.
  const hasStreak = streak > 0;
  const hasRank = Boolean(rank && rank.rank > 0);
  const showStatus = hasStreak || hasRank;

  // aria-label según el contenido real (los iconos no llevan texto visible).
  let statusAria;
  if (hasStreak && hasRank) statusAria = t("cdd.rankStreakAria", { streak, rank: rank.rank });
  else if (hasRank) statusAria = t("cdd.rankAria", { rank: rank.rank });
  else if (hasStreak) statusAria = t("cdd.streakAria", { streak });
  else statusAria = t("cdd.competeAria");

  return (
    <header className="cdd-header">
      <div className="cdd-wordmark">
        {/* Estilos en index.css (.cdd-title/.cdd-date): wordmark protagonista +
            fecha como dateline editorial debajo (mantiene el ritual diario sin
            coste de alto, cabe dentro de la altura de la fila de acciones). */}
        <div className="flex flex-col">
          <span className="cdd-title">{t("app.title")}</span>
          <span className="cdd-date cdd-mono">{dateLabel}</span>
        </div>
      </div>

      <nav className="cdd-nav">
        {/* PÍLDORA DE ESTADO (héroe): funde los dos motores de retorno diario
            —no rompas la racha (🔥) y sube en el ranking (🏆#)— en una unidad
            glanceable y tappable que abre el ranking. Si el jugador aún no tiene
            racha ni puesto (o es anónimo), vende lo que se pierde: "Compite →"
            — y el modal de ranking ya trae su propio CTA de login para el
            anónimo. Tinte de acento = es el elemento dominante de la barra. */}
        <button
          type="button"
          className={"cdd-statuspill" + (pop ? " pop" : "")}
          onClick={() => { haptic.impactLight(); onOpenRanking?.(); }}
          aria-label={statusAria}
          title={statusAria}
        >
          {showStatus ? (
            <>
              {hasStreak && (
                <span className="seg">
                  <Icon d={I.flame} size={15} /> <b>{streak}</b>
                </span>
              )}
              {hasStreak && hasRank && <span className="divider" aria-hidden="true" />}
              {hasRank && (
                <span className="seg">
                  <Icon d={I.trophy} size={15} /> <b className="tabular-nums">#{rank.rank}</b>
                </span>
              )}
            </>
          ) : (
            <span className="seg">
              <Icon d={I.trophy} size={15} /> <b>{t("cdd.competeLabel")}</b>
              <Icon d={I.chevR} size={14} />
            </span>
          )}
        </button>

        {/* Utilidades (gris apagado): subordinadas a la píldora por COLOR, no
            por tamaño. Garaje lleva el punto de alerta de repesca. */}
        <button
          className="cdd-iconbtn"
          aria-label={repescaAlert ? t("cdd.garageRepescaAria") : t("cdd.garageAria")}
          title={repescaAlert ? t("cdd.garageRepescaAria") : t("cdd.garageAria")}
          onClick={() => { haptic.impactLight(); onOpenGarage?.(); }}
        >
          <Icon d={I.garage} size={18} />
          {repescaAlert && <span className="cdd-alert-dot" aria-hidden="true" />}
        </button>

        <button
          className="cdd-iconbtn"
          aria-label={t("cdd.profileAria")}
          title={t("cdd.profileAria")}
          onClick={() => { haptic.impactLight(); (user ? onOpenProfile : onOpenLogin)?.(); }}
        >
          <Icon d={I.user} size={18} />
        </button>
      </nav>
    </header>
  );
}
