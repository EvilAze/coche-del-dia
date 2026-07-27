// src/components/PodiumMedals.jsx
// Vitrina de medallas de PODIO de un usuario: oro / plata / bronce. Dos grupos:
//   · Temporada (nuevo): "Campeón · Grupo B" — el tema es lo coleccionable.
//   · Mes (legado): "Primero en mayo de 2026" — se preservan las medallas
//     mensuales ya ganadas aunque el ranking mensual se retirara (Decisión C).
// Autónomo: recibe un userId y pide sus medallas. Mientras carga o si no tiene
// ninguna, no renderiza nada — el padre no necesita gestionar estado.
//
// Las de temporada las materializa el cierre de temporada (close_finished_seasons,
// piggyback en warm-daily); las de mes las materializó el cron mensual retirado.

import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { getSeasonMedals, getMonthlyMedals } from "../lib/statsService";

// Estilo del borde + texto según el puesto, en sintonía con los tiers de logros
// (oro/plata/bronce). El icono hereda este color vía currentColor.
// Los tres van por token: el oro ya lo era, pero plata y bronce se pintaban
// con paleta cruda de Tailwind (zinc-300 / amber-700), que no sigue al tema.
// El zinc-300 sobre el papel crema del modo día daba 1.4:1 — una medalla de
// plata prácticamente invisible justo para el jugador que la ganó.
const RANK_STYLE = {
  1: { border: "border-gold/60", text: "text-gold" },
  2: { border: "border-plata/60", text: "text-plata" },
  3: { border: "border-bronce/60", text: "text-bronce" },
};

// Medalla line-art (mismo trazo que el set de iconos del Perfil). NO usamos emoji
// a propósito: renderizan distinto por plataforma y, mal codificados, se rompían
// en mojibake. Este SVG hereda color (currentColor) y tamaño (className).
function MedalIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="14" r="6" />
      <path d="M9 9 6.5 3.5M15 9l2.5-5.5" />
    </svg>
  );
}

function formatMonth(monthStr, dateLocale) {
  // monthStr = "2026-05-01". Anclamos a mediodía para que el cambio de zona
  // horaria al formatear no nos desplace al mes anterior.
  const d = new Date(`${monthStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return monthStr;
  try {
    return new Intl.DateTimeFormat(dateLocale, {
      month: "long",
      year: "numeric",
    }).format(d);
  } catch {
    return monthStr;
  }
}

// Chip de medalla compartido por ambos grupos: icono + puesto + subtítulo
// (tema de temporada o mes).
function MedalChip({ rank, place, subtitle, title }) {
  const style = RANK_STYLE[rank] || RANK_STYLE[3];
  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg border ${style.border} bg-bg-tertiary px-2.5 py-1.5`}
      title={title}
    >
      <span className={style.text}>
        <MedalIcon className="h-[18px] w-[18px]" />
      </span>
      <span className="flex flex-col leading-tight">
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${style.text}`}>
          {place}
        </span>
        <span className="text-[10px] capitalize text-muted-foreground">{subtitle}</span>
      </span>
    </div>
  );
}

export default function PodiumMedals({ userId }) {
  const { t, locale, dateLocale } = useT();
  const [season, setSeason] = useState([]);
  const [monthly, setMonthly] = useState([]);

  useEffect(() => {
    if (!userId) {
      setSeason([]);
      setMonthly([]);
      return;
    }
    let cancelled = false;
    Promise.all([getSeasonMedals(userId), getMonthlyMedals(userId)])
      .then(([s, m]) => {
        if (!cancelled) {
          setSeason(s);
          setMonthly(m);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSeason([]);
          setMonthly([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (season.length === 0 && monthly.length === 0) return null;

  return (
    <div className="space-y-4">
      {season.length > 0 && (
        <section>
          <h4 className="mb-2 text-[10px] uppercase tracking-[0.22em] text-accent">
            {t("podium.titleSeason")}
          </h4>
          <div className="flex flex-wrap gap-2">
            {season.map((m) => {
              const place = t(`podium.rank${m.rank}`);
              const label = (locale === "en" ? m.labelEn : m.labelEs) || "";
              return (
                <MedalChip
                  key={`s-${m.number}-${m.rank}`}
                  rank={m.rank}
                  place={place}
                  subtitle={label}
                  title={t("podium.medalAriaSeason", { place, season: label })}
                />
              );
            })}
          </div>
        </section>
      )}

      {monthly.length > 0 && (
        <section>
          <h4 className="mb-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {t("podium.titleLegacy")}
          </h4>
          <div className="flex flex-wrap gap-2">
            {monthly.map((m) => {
              const place = t(`podium.rank${m.rank}`);
              const monthLabel = formatMonth(m.month, dateLocale);
              return (
                <MedalChip
                  key={`m-${m.month}-${m.rank}`}
                  rank={m.rank}
                  place={place}
                  subtitle={monthLabel}
                  title={t("podium.medalAria", { place, month: monthLabel })}
                />
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
