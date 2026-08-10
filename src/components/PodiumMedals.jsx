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

// El metal de cada puesto. Es una CLASE del sistema (index.css, .prensa-medalla
// .oro/.plata/.bronce) y no un filete de color: la medalla se dibuja con filete
// de tinta como todo lo demás y el metal se reserva al disco y al puesto. Antes
// cada una traía su propio borde en su color al 60%, así que tres medallas
// seguidas eran tres cajas de tres colores distintos flotando sobre el papel.
const RANK_METAL = { 1: "oro", 2: "plata", 3: "bronce" };

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
  const metal = RANK_METAL[rank] || RANK_METAL[3];
  return (
    <div className="prensa-medalla" title={title}>
      <span className={metal}>
        <MedalIcon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0">
        <span className={`puesto ${metal}`}>{place}</span>
        <span className="de capitalize">{subtitle}</span>
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
          <h4 className="pm-label mb-2">{t("podium.titleSeason")}</h4>
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
          <h4 className="pm-label mb-2">{t("podium.titleLegacy")}</h4>
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
