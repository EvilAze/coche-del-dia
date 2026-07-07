// src/components/Achievements.jsx
// RUTA de progresión de logros PERSONALES (Colección + Rachas). Vive dentro
// del modal de Logros (AchievementsModal).
//
// ARQUITECTURA (v6, rediseño 2026-06): de cuadrícula de badges a DOS rutas
// (Colección, Racha). Cada categoría es una escalera con su línea-camino: el
// nodo es la CIFRA-objetivo (1·10·25·50·100 / 7·30·100), no un icono pictórico
// (esos desentonaban con lo premium/limpio). El estado se lee de un vistazo:
//   · conseguido → moneda de oro maciza
//   · próximo    → diana de oro, con barra y "te faltan X"
//   · bloqueado  → contorno apagado
// El alma "automotive" vive en los NOMBRES (Concesionario, Salón de la fama,
// Piloto de Leyenda), igual que el reparto número-limpio + voz-del-juego del
// Perfil. Las colecciones marca/país NO están aquí: son el Garaje.
//
// El fetch sigue computando TODOS los logros vía el notifier compartido (ese
// cálculo alimenta persistencia y toasts post-victoria); aquí solo filtramos
// y reordenamos QUÉ se muestra.

import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n";
import { detectAndPersistNewAchievements } from "../lib/achievementsNotifier";

// Categorías que se MUESTRAN en este panel (marca/país viven en el Garaje).
const DISPLAY_CATEGORIES = ["milestone", "streak"];

export default function Achievements({ stats, onProgress }) {
  const { t, locale } = useT();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    detectAndPersistNewAchievements({ stats })
      .then(({ items: result }) => {
        if (cancelled) return;
        setItems(result);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[Achievements] load:", err);
        setError(t("achievements.errorLoad"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stats, t]);

  // Solo hitos + rachas, en orden ascendente de dificultad (la escalera).
  const groups = useMemo(() => {
    const map = new Map();
    for (const a of items) {
      if (!DISPLAY_CATEGORIES.includes(a.category)) continue;
      if (!map.has(a.category)) map.set(a.category, []);
      map.get(a.category).push(a);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.progress.total - b.progress.total);
    }
    return DISPLAY_CATEGORIES.filter((c) => map.has(c)).map((c) => ({
      category: c,
      items: map.get(c),
    }));
  }, [items]);

  // Progreso global (de lo mostrado) para el anillo del modal.
  const totals = useMemo(() => {
    let unlocked = 0;
    let total = 0;
    for (const g of groups) {
      for (const a of g.items) {
        total += 1;
        if (a.unlocked) unlocked += 1;
      }
    }
    return { unlocked, total };
  }, [groups]);

  useEffect(() => {
    onProgress?.(totals);
  }, [totals, onProgress]);

  if (loading) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        {t("achievements.loading")}
      </p>
    );
  }
  if (error) {
    return <p className="py-8 text-center text-sm text-red-400">{error}</p>;
  }
  if (totals.total === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        {t("achievements.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-7">
      {groups.map(({ category, items: groupItems }) => {
        const done = groupItems.filter((a) => a.unlocked).length;
        // El "próximo" es el primer no desbloqueado de la escalera.
        const nextIdx = groupItems.findIndex((a) => !a.unlocked);
        return (
          <section key={category}>
            <div className="mb-3 flex items-baseline justify-between">
              <h4 className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
                {t(`achievements.category.${category}`)}
              </h4>
              <span className="text-[11px] tabular-nums text-tinta-2/70">
                {done} / {groupItems.length}
              </span>
            </div>
            <div>
              {groupItems.map((a, i) => (
                <RouteNode
                  key={a.id}
                  achievement={a}
                  locale={locale}
                  isNext={i === nextIdx}
                  first={i === 0}
                  last={i === groupItems.length - 1}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CheckIcon({ className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

// Un peldaño de la ruta: raíl con nodo numérico + contenido según estado.
// El conector se dibuja en DOS segmentos (arriba/abajo del nodo) para no
// cruzar por detrás del nodo — así su fondo puede ser transparente.
function RouteNode({ achievement, locale, isNext, first, last }) {
  const { t } = useT();
  const { unlocked, progress } = achievement;
  const goal = progress.total; // la cifra-objetivo (umbral del hito/racha)
  const remaining = Math.max(0, progress.total - progress.current);
  const pct = progress.total
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0;

  const title =
    achievement.title?.[locale] ||
    achievement.title?.es ||
    achievement.title?.en ||
    "";
  const description =
    achievement.description?.[locale] ||
    achievement.description?.es ||
    achievement.description?.en ||
    "";

  // Texto "te faltan X" con unidad y plural correctos según categoría.
  const isStreak = achievement.category === "streak";
  const remainingKey = isStreak
    ? remaining === 1
      ? "achievements.remainingDay"
      : "achievements.remainingDays"
    : remaining === 1
      ? "achievements.remainingCar"
      : "achievements.remainingCars";

  const nodeCls = unlocked
    ? "border border-transparent bg-gold text-gold-ink" // moneda de oro maciza
    : isNext
      ? "border-2 border-gold bg-transparent text-gold" // diana
      : "border border-border bg-papel/[0.02] text-tinta-2/70"; // apagado

  return (
    <div className="flex items-stretch gap-3.5">
      {/* Raíl + nodo */}
      <div className="relative flex w-9 shrink-0 items-center justify-center">
        {!first && (
          <div
            className="absolute left-1/2 top-0 w-0.5 -translate-x-1/2 bg-border"
            style={{ height: "calc(50% - 18px)" }}
          />
        )}
        {!last && (
          <div
            className="absolute bottom-0 left-1/2 w-0.5 -translate-x-1/2 bg-border"
            style={{ height: "calc(50% - 18px)" }}
          />
        )}
        <span
          className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full font-bold tabular-nums ${
            String(goal).length >= 3 ? "text-[11px]" : "text-sm"
          } ${nodeCls}`}
        >
          {goal}
        </span>
      </div>

      {/* Contenido */}
      <div className="min-w-0 flex-1 pb-5 pt-1.5">
        {unlocked ? (
          <>
            <p className="text-[15px] font-semibold text-tinta">{title}</p>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-gold">
              <CheckIcon className="h-3 w-3" />
              {t("achievements.unlocked")}
            </p>
          </>
        ) : isNext ? (
          <>
            <div className="flex items-center gap-2">
              <p className="text-[15px] font-bold text-tinta">{title}</p>
              <span className="rounded-full border border-gold/40 px-2 py-px font-mono text-[8.5px] uppercase tracking-wider text-gold">
                {t("achievements.next")}
              </span>
            </div>
            <div className="mt-1.5 h-[5px] max-w-[170px] overflow-hidden rounded-full bg-papel/[0.08]">
              <div
                className="h-full rounded-full bg-gold"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11.5px] text-tinta">
              {t(remainingKey, { count: remaining })} ·{" "}
              <span className="tabular-nums">
                {progress.current}/{progress.total}
              </span>
            </p>
          </>
        ) : (
          <>
            <p className="text-[15px] font-medium text-tinta-2">{title}</p>
            <p className="mt-0.5 text-[11px] text-tinta-2/70">{description}</p>
          </>
        )}
      </div>
    </div>
  );
}
