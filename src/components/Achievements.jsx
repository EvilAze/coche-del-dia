// src/components/Achievements.jsx
// Grid de logros PERSONALES (Colección + Rachas). Vive dentro del modal
// de Logros (AchievementsModal).
//
// ARQUITECTURA (v5): las colecciones por marca/país ya NO se muestran
// aquí — esa "colección" es exactamente lo que enseña el Garaje (países →
// marcas → coches, con medalla de tier en cada tarjeta). Tenerlas también
// como badges era duplicar el mismo dato. Aquí quedan solo los logros que
// NO viven en ningún otro sitio:
//   · Colección (hitos de coches totales): Primer coche → Salón de la fama
//   · Rachas (días seguidos): Chispa → Pleno motor
//
// Con 8 piezas caben sin scroll y con tarjetas grandes — el objetivo es
// que se sientan premium, no apretadas.
//
// El fetch sigue computando TODOS los logros (incluidas marcas/países) vía
// el notifier compartido, porque ese cálculo alimenta la persistencia y
// los toasts post-victoria. Aquí solo filtramos QUÉ se muestra.

import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n";
import { detectAndPersistNewAchievements } from "../lib/achievementsNotifier";
import AchievementIcon from "./AchievementIcons";

// Categorías que se MUESTRAN en este panel (las colecciones marca/país
// se han movido al Garaje). Orden de aparición.
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

  // Solo hitos + rachas, en orden ascendente de dificultad.
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
    <div className="space-y-5">
      {groups.map(({ category, items: groupItems }) => {
        const done = groupItems.filter((a) => a.unlocked).length;
        return (
          <section key={category}>
            <div className="mb-2.5 flex items-baseline justify-between">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">
                {t(`achievements.category.${category}`)}
              </h4>
              <span className="text-[11px] tabular-nums text-muted">
                {done} / {groupItems.length}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {groupItems.map((a) => (
                <Badge key={a.id} achievement={a} locale={locale} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Badge({ achievement, locale }) {
  const { unlocked, progress } = achievement;
  const pct = Math.min(
    100,
    Math.round((progress.current / progress.total) * 100)
  );
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

  return (
    <div
      className={`
        group relative flex flex-col items-center gap-2 overflow-hidden
        rounded-2xl border px-2 py-3.5 text-center transition-all duration-300
        ${unlocked
          ? "border-accent/40 bg-accent/[0.07] shadow-[0_0_22px_-8px_rgba(232,200,122,0.6)]"
          : "border-white/[0.06] bg-white/[0.02]"}
      `}
      title={`${title} — ${description}`}
    >
      {/* Brillo diagonal en los conseguidos. */}
      {unlocked && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.07] to-transparent" />
      )}

      {/* Candado en bloqueados. */}
      {!unlocked && (
        <span className="absolute right-2 top-2 text-white/20" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </span>
      )}

      <span className={`relative ${unlocked ? "drop-shadow-[0_0_6px_rgba(232,200,122,0.4)]" : ""}`}>
        <AchievementIcon
          name={achievement.icon?.name}
          size="h-9 w-9"
          color={unlocked ? "text-accent" : "text-white/25"}
        />
      </span>

      <span
        className={`relative line-clamp-2 min-h-[1.9em] text-[10.5px] font-medium leading-tight ${
          unlocked ? "text-white" : "text-muted"
        }`}
      >
        {title}
      </span>

      {/* Estado: barra + x/y mientras está bloqueado; chip ✓ al lograrlo. */}
      {unlocked ? (
        <span className="relative inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-accent">
          <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
          {progress.total}
        </span>
      ) : (
        <div className="relative w-full px-1">
          <div className="h-1 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-accent/80 transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="mt-1 block text-[9px] tabular-nums text-muted">
            {progress.current}/{progress.total}
          </span>
        </div>
      )}
    </div>
  );
}
