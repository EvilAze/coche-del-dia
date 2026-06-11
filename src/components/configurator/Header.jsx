// src/components/configurator/Header.jsx
// Cabecera del configurador: wordmark CDD + pastilla de racha + accesos
// (perfil/login · ranking · garaje). El "?" de ayuda vive en la intro, junto al
// H1 (lo renderiza Configurator), para no saturar la barra en móvil.

import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { haptic } from "../../lib/haptics";
import { Icon, I } from "./icons";

export default function Header({
  streak = 0,
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

  // Pop de la píldora de racha cuando SUBE (tras ganar): un latido breve que
  // celebra el incremento sin ser estridente.
  const prevStreak = useRef(streak);
  const [pop, setPop] = useState(false);
  useEffect(() => {
    // Solo late en un incremento REAL (p.ej. 4→5 tras ganar). El 0→N de la carga
    // inicial / login no debe latir (parecería un glitch).
    if (streak > prevStreak.current && prevStreak.current > 0) {
      setPop(true);
      const id = setTimeout(() => setPop(false), 440);
      prevStreak.current = streak;
      return () => clearTimeout(id);
    }
    prevStreak.current = streak;
  }, [streak]);

  return (
    <header className="cdd-header">
      <div className="cdd-wordmark">
        {/* Estilos en index.css (.cdd-title/.cdd-date), no inline: la fecha iba
            forzada a 9px con tracking .12em — mono caps a ese cuerpo se empasta
            en pantallas de DPI bajo (auditoría UX, mismo criterio que labels). */}
        <div className="flex flex-col">
          <span className="cdd-title">{t("app.title")}</span>
          <span className="cdd-date cdd-mono">{dateLabel}</span>
        </div>
      </div>
      <nav className="cdd-nav">
        {streak > 0 && (
          <span className={"cdd-streakpill" + (pop ? " pop" : "")} title={`${t("cdd.statStreak") || "Racha"} ${streak}`}>
            <Icon d={I.flame} size={15} /> <b>{streak}</b>
          </span>
        )}
        {/* title = tooltip nativo en desktop: los iconos sin etiqueta obligaban
            a adivinar (auditoría UX #6); en táctil no estorba. */}
        <button
          className="cdd-iconbtn"
          aria-label={t("cdd.profileAria")}
          title={t("cdd.profileAria")}
          onClick={() => { haptic.impactLight(); (user ? onOpenProfile : onOpenLogin)?.(); }}
        >
          <Icon d={I.user} size={18} />
        </button>
        <button
          className="cdd-iconbtn"
          aria-label={t("cdd.statsAria")}
          title={t("cdd.statsAria")}
          onClick={() => { haptic.impactLight(); onOpenRanking?.(); }}
        >
          <Icon d={I.stats} size={18} />
        </button>
        {/* Con repesca disponible, el tooltip/aria EXPLICA el punto de alerta:
            un badge sin texto obliga a adivinar qué hay de nuevo (auditoría #6). */}
        <button
          className="cdd-iconbtn"
          aria-label={repescaAlert ? t("cdd.garageRepescaAria") : t("cdd.garageAria")}
          title={repescaAlert ? t("cdd.garageRepescaAria") : t("cdd.garageAria")}
          onClick={() => { haptic.impactLight(); onOpenGarage?.(); }}
        >
          <Icon d={I.garage} size={18} />
          {repescaAlert && <span className="cdd-alert-dot" aria-hidden="true" />}
        </button>
      </nav>
    </header>
  );
}
