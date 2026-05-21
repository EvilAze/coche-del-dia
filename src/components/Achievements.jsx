// src/components/Achievements.jsx
// Grid de logros (badges) — pensado para vivir DENTRO de MyStats. Estados:
//   - unlocked → badge a color, brillante.
//   - locked   → badge en grayscale + opacity, con barra de progreso X/Y.
//
// Se agrupan por categoría con un sub-header textual (marca, país, hito,
// constancia). La cabecera muestra el conteo total "X / Y".

import { useEffect, useMemo, useState } from "react";
import { useT, getLocalizedCountry } from "../i18n";
import { computeAchievements } from "../lib/achievements";
import { loadCatalog } from "../data/catalog";
import { getMyWonCarIds } from "../hooks/useStats";

// Mismas convenciones de slug que Garage.jsx para que los iconos
// (logos de marca, banderas) resuelvan correctamente sin 404s.
function brandSlug(marca) {
  return String(marca || "").toLowerCase().replace(/\s+/g, "-");
}
function countrySlug(pais) {
  return String(pais || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\./g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
}

const CATEGORY_ORDER = ["milestone", "streak", "brand", "country"];

export default function Achievements({ stats }) {
  const { t, locale } = useT();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);

  // Carga del catálogo + wins del usuario en paralelo. Ambos son baratos
  // (catalog está cacheado en sesión; wins es una query simple a
  // user_guesses con RLS).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([loadCatalog(), getMyWonCarIds()])
      .then(([catalog, wonCarIds]) => {
        if (cancelled) return;
        const result = computeAchievements({
          cars: catalog?.cars || [],
          wonCarIds: wonCarIds || [],
          stats: stats || {},
        });
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

  const groups = useMemo(() => {
    const map = new Map();
    for (const a of items) {
      if (!map.has(a.category)) map.set(a.category, []);
      map.get(a.category).push(a);
    }
    // Ordenar dentro de cada grupo: primero unlocked (más reciente
    // = top), luego locked por progreso descendente (más cerca de
    // desbloquear primero).
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
        if (a.unlocked) return 0;
        const pa = a.progress.current / a.progress.total;
        const pb = b.progress.current / b.progress.total;
        return pb - pa;
      });
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
      category: c,
      items: map.get(c),
    }));
  }, [items]);

  const totalUnlocked = items.filter((a) => a.unlocked).length;
  const totalCount = items.length;

  if (loading) {
    return (
      <p className="text-center text-sm text-muted">
        {t("achievements.loading")}
      </p>
    );
  }
  if (error) {
    return <p className="text-center text-sm text-red-400">{error}</p>;
  }
  if (totalCount === 0) {
    return (
      <p className="text-center text-sm text-muted">
        {t("achievements.empty")}
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-base tracking-widest text-white">
          {t("achievements.sectionTitle")}
        </h3>
        <span className="text-xs tabular-nums text-muted">
          {totalUnlocked} / {totalCount}
        </span>
      </div>

      <div className="space-y-4">
        {groups.map(({ category, items: groupItems }) => (
          <section key={category}>
            <h4 className="mb-2 text-[10px] uppercase tracking-[0.22em] text-accent">
              {t(`achievements.category.${category}`)}
            </h4>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {groupItems.map((a) => (
                <Badge
                  key={a.id}
                  achievement={a}
                  locale={locale}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Badge({ achievement, locale }) {
  const { unlocked, progress } = achievement;
  const pct = Math.min(100, Math.round((progress.current / progress.total) * 100));
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

  // Color del borde según tier. Si no hay tier (hitos, rachas), usamos
  // accent (oro/ámbar de la marca).
  const tierBorder =
    achievement.tier === "gold"
      ? "border-yellow-300/80"
      : achievement.tier === "silver"
      ? "border-zinc-300/70"
      : achievement.tier === "bronze"
      ? "border-amber-700/70"
      : "border-accent/60";

  return (
    <div
      className={`
        group relative aspect-square overflow-hidden rounded-lg
        border ${unlocked ? tierBorder : "border-white/10"}
        bg-white/[0.04] p-2
        ${unlocked ? "" : "opacity-50"}
        transition hover:opacity-100 hover:border-accent/70
      `}
      title={`${title} — ${description}`}
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5">
        <BadgeIcon achievement={achievement} muted={!unlocked} />
        {achievement.tier && (
          <span
            className={`
              text-[8px] uppercase tracking-[0.18em]
              ${
                achievement.tier === "gold"
                  ? "text-yellow-300"
                  : achievement.tier === "silver"
                  ? "text-zinc-300"
                  : "text-amber-600"
              }
            `}
          >
            {achievement.tier}
          </span>
        )}
        {!unlocked && (
          <div className="absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-accent/80 transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function BadgeIcon({ achievement, muted }) {
  const { icon, group } = achievement;
  const filter = muted ? "grayscale(1)" : undefined;

  if (icon.kind === "brand") {
    const src = `/brands/${brandSlug(icon.value)}.png`;
    return (
      <img
        src={src}
        alt={group || ""}
        draggable={false}
        loading="lazy"
        className="h-10 w-10 object-contain"
        style={{ filter }}
        onError={(e) => {
          // Si falta el logo concreto, fallback a un texto con la inicial.
          e.currentTarget.style.display = "none";
          e.currentTarget.nextSibling?.removeAttribute?.("hidden");
        }}
      />
    );
  }

  if (icon.kind === "country") {
    const src = `/flags/${countrySlug(icon.value)}.jpg`;
    return (
      <img
        src={src}
        alt={group ? getLocalizedCountry(group) : ""}
        draggable={false}
        loading="lazy"
        className="h-10 w-10 rounded-sm object-cover"
        style={{ filter }}
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    );
  }

  // Emoji u otro → texto grande
  return (
    <span className="font-display text-3xl leading-none" style={{ filter }}>
      {icon.value}
    </span>
  );
}
