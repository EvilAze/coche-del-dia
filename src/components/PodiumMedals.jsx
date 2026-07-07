// src/components/PodiumMedals.jsx
// Medallas de PODIO mensual de un usuario: ðŸ¥‡ðŸ¥ˆðŸ¥‰ "Primero en mayo de 2026".
// AutÃ³nomo: recibe un userId y se encarga de pedir sus medallas a
// getMonthlyMedals (lee la tabla pÃºblica monthly_podium). Mientras carga o si
// no hay ninguna, no renderiza nada â€” el padre no necesita gestionar estado.
//
// Las medallas las materializa el cron mensual (api/cron/monthly-podium.js)
// sobre meses CERRADOS; ver scripts/supabase-monthly-ranking.sql.

import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { getMonthlyMedals } from "../lib/statsService";

const MEDAL_EMOJI = { 1: "ðŸ¥‡", 2: "ðŸ¥ˆ", 3: "ðŸ¥‰" };

// Estilo del borde/etiqueta segÃºn el puesto, en sintonÃ­a con los tiers de
// logros (oro/plata/bronce) que ya usa PublicProfile.
const RANK_STYLE = {
  1: { border: "border-gold/70", text: "text-gold" },
  2: { border: "border-zinc-300/60", text: "text-zinc-300" },
  3: { border: "border-amber-700/60", text: "text-amber-600" },
};

function formatMonth(monthStr, dateLocale) {
  // monthStr = "2026-05-01". Anclamos a mediodÃ­a para que el cambio de zona
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
              className={`flex items-center gap-1.5 rounded-lg border ${style.border} bg-papel/[0.04] px-2.5 py-1.5`}
              title={t("podium.medalAria", { place, month: monthLabel })}
            >
              <span className="text-base leading-none" aria-hidden="true">
                {MEDAL_EMOJI[m.rank] || "ðŸ…"}
              </span>
              <span className="flex flex-col leading-tight">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${style.text}`}>
                  {place}
                </span>
                <span className="text-[10px] capitalize text-muted">
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
