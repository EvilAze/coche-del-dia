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
    .toLocaleDateString(dateLocale, { weekday: "long", day: "numeric", month: "long" });

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
    <header className="flex items-center justify-between">
      <div className="flex min-w-0 flex-col">
        <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{t("app.title")}</h1>
        <p className="text-xs capitalize text-muted-foreground">{dateLabel}</p>
      </div>

      {/* Fila de iconos: barra unificada estilo "control center" con bordes y fondos
          sutiles. Cada utilidad se ilumina con su color temático en hover (ranking -> oro,
          garaje -> menta, perfil -> blanco) con un halo de luz y escala táctil. */}
      <nav className="flex items-center gap-1 rounded-xl border border-border/30 bg-bg-secondary/40 p-0.5 backdrop-blur-sm" aria-label={t("cdd.competeAria")}>
        <button
          type="button"
          aria-label={statusAria}
          title={statusAria}
          onClick={() => { haptic.impactLight(); onOpenRanking?.(); }}
          className="flex size-9 items-center justify-center rounded-lg border border-transparent text-foreground/70 transition-all duration-300 hover:scale-105 hover:bg-gold/10 hover:text-gold hover:border-gold/25 hover:shadow-[0_0_10px_rgba(232,200,122,0.15)] active:scale-95"
        >
          <Icon d={I.trophy} size={20} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label={repescaAlert ? t("cdd.garageRepescaAria") : t("cdd.garageAria")}
          title={repescaAlert ? t("cdd.garageRepescaAria") : t("cdd.garageAria")}
          onClick={() => { haptic.impactLight(); onOpenGarage?.(); }}
          className="relative flex size-9 items-center justify-center rounded-lg border border-transparent text-foreground/70 transition-all duration-300 hover:scale-105 hover:bg-accent/10 hover:text-accent hover:border-accent/25 hover:shadow-[0_0_10px_rgba(122,240,200,0.15)] active:scale-95"
        >
          <Icon d={I.garage} size={20} strokeWidth={1.8} />
          {repescaAlert && (
            <span className="absolute right-1 top-1 size-1.5 rounded-full bg-mint shadow-[0_0_6px_rgba(122,240,200,0.7)]" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          aria-label={t("cdd.profileAria")}
          title={t("cdd.profileAria")}
          onClick={() => { haptic.impactLight(); (user ? onOpenProfile : onOpenLogin)?.(); }}
          className="flex size-9 items-center justify-center rounded-lg border border-transparent text-foreground/70 transition-all duration-300 hover:scale-105 hover:bg-white/10 hover:text-white hover:border-white/25 hover:shadow-[0_0_10px_rgba(255,255,255,0.1)] active:scale-95"
        >
          <Icon d={I.user} size={20} strokeWidth={1.8} />
        </button>
      </nav>
    </header>
  );
}
