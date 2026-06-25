// src/components/PodiumMedals.jsx
// Medallas de PODIO mensual de un usuario: oro / plata / bronce, p.ej.
// "Primero en mayo de 2026". Autónomo: recibe un userId y se encarga de pedir
// sus medallas a getMonthlyMedals (lee la tabla pública monthly_podium).
// Mientras carga o si no hay ninguna, no renderiza nada — el padre no necesita
// gestionar estado.
//
// Las medallas las materializa el cron mensual (api/cron/monthly-podium.js)
// sobre meses CERRADOS; ver scripts/supabase-monthly-ranking.sql.

import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { getMonthlyMedals } from "../lib/statsService";

// Estilo del borde + texto según el puesto, en sintonía con los tiers de
// logros (oro/plata/bronce) que ya usan el Garaje y el Perfil. El icono
// hereda este color vía currentColor (se envuelve en un <span> con `text`).
const RANK_STYLE = {
  1: { border: "border-gold/60", text: "text-gold" },
  2: { border: "border-zinc-300/50", text: "text-zinc-300" },
  3: { border: "border-amber-700/60", text: "text-amber-600" },
};

// Medalla line-art (mismo trazo que el set de iconos del Perfil). NO usamos
// emoji a propósito: los emoji de medalla renderizan distinto en cada
// plataforma y, mal codificados en el fuente, se rompían en mojibake. Este
// SVG hereda color (currentColor) y tamaño (className), y es cross-platform.
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

export default function PodiumMedals({ userId }) {
  const { t, dateLocale } = useT();
  const [medals, setMedals] = useState([]);

  useEffect(() => {
    if (!userId) {
      setMedals([]);
      return;
    }
    let cancelled = false;
    getMonthlyMedals(userId)
      .then((rows) => {
        if (!cancelled) setMedals(rows);
      })
      .catch(() => {
        if (!cancelled) setMedals([]);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (medals.length === 0) return null;

  return (
    <section>
      <h4 className="mb-2 text-[10px] uppercase tracking-[0.22em] text-accent">
        {t("podium.title")}
      </h4>
      <div className="flex flex-wrap gap-2">
        {medals.map((m) => {
          const style = RANK_STYLE[m.rank] || RANK_STYLE[3];
          const place = t(`podium.rank${m.rank}`);
          const monthLabel = formatMonth(m.month, dateLocale);
          return (
            <div
              key={`${m.month}-${m.rank}`}
              className={`flex items-center gap-1.5 rounded-lg border ${style.border} bg-bg-tertiary px-2.5 py-1.5`}
              title={t("podium.medalAria", { place, month: monthLabel })}
            >
              <span className={style.text}>
                <MedalIcon className="h-[18px] w-[18px]" />
              </span>
              <span className="flex flex-col leading-tight">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${style.text}`}>
                  {place}
                </span>
                <span className="text-[10px] capitalize text-muted-foreground">
                  {monthLabel}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
