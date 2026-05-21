// src/components/Achievements.jsx
// Grid de logros (badges) — pensado para vivir DENTRO de MyStats. Estados:
//   - unlocked → badge a color, brillante.
//   - locked   → badge en grayscale + opacity, con barra de progreso X/Y.
//
// Se agrupan por categoría con un sub-header textual (marca, país, hito,
// constancia). La cabecera muestra el conteo total "X / Y".

import { useEffect, useMemo, useState } from "react";
import { useT, getLocalizedCountry } from "../i18n";
import { detectAndPersistNewAchievements } from "../lib/achievementsNotifier";

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

  // Toda la lógica de fetch + compute + persistencia vive en el notifier
  // compartido (reusado por useGame/Repesca para los toasts post-victoria).
  // Aquí solo nos quedamos con `items` para pintar el grid; el array
  // `newlyUnlocked` no se usa desde MyStats — la notificación celebratoria
  // ya pasó al ganar la partida, no al abrir el perfil.
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

  const groups = useMemo(() => {
    const map = new Map();
    for (const a of items) {
      if (!map.has(a.category)) map.set(a.category, []);
      map.get(a.category).push(a);
    }
    for (const [category, arr] of map.entries()) {
      if (category === "milestone" || category === "streak") {
        // Hitos y rachas: orden ascendente fijo por dificultad. Esto da
        // un orden estable e intuitivo (1 → 10 → 25 → 50 → 100, etc.),
        // sin importar cuáles tiene desbloqueados el usuario.
        arr.sort((a, b) => a.progress.total - b.progress.total);
      } else {
        // Colecciones (marca/país): primero las completadas (oro+plata
        // todo), luego en progreso por % desc (más cerca de subir
        // tier primero), luego intactas por nombre.
        arr.sort((a, b) => {
          if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
          const pa = a.progress.current / a.progress.total;
          const pb = b.progress.current / b.progress.total;
          if (pa !== pb) return pb - pa;
          return String(a.group).localeCompare(String(b.group), "es");
        });
      }
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
      category: c,
      items: map.get(c),
    }));
  }, [items]);

  // Para el contador "X / Y" mostramos algo significativo: en colecciones
  // contamos por TIERS individuales (más motivante: "tienes 12 medallas
  // de 60") en lugar de "8 / 40 colecciones completas".
  let totalUnlocked = 0;
  let totalCount = 0;
  for (const a of items) {
    if (Array.isArray(a.tiers) && a.tiers.length > 0) {
      totalUnlocked += a.tiers.filter((t) => t.achieved).length;
      totalCount += a.tiers.length;
    } else {
      totalCount += 1;
      if (a.unlocked) totalUnlocked += 1;
    }
  }

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

// Color CSS por tier (texto y borde). Centralizado para que la card y
// el chip usen el mismo paleta.
function tierColors(tier) {
  switch (tier) {
    case "gold":
      return { text: "text-yellow-300", border: "border-yellow-300/80" };
    case "silver":
      return { text: "text-zinc-300", border: "border-zinc-300/70" };
    case "bronze":
      return { text: "text-amber-600", border: "border-amber-700/70" };
    default:
      return { text: "text-accent", border: "border-accent/60" };
  }
}

function Badge({ achievement, locale }) {
  const { unlocked, progress, currentTier, nextTier, tiers } = achievement;
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

  // Tier visual de referencia para borde:
  //   - colección con currentTier → ese color
  //   - colección sin desbloquear → borde sutil blanco
  //   - hitos/rachas: accent si unlocked, blanco si no
  const isCollection = Array.isArray(tiers) && tiers.length > 0;
  const borderClass = unlocked
    ? tierColors(isCollection ? currentTier : "gold").border
    : currentTier
    ? tierColors(currentTier).border
    : "border-white/10";

  // El icono queda atenuado solo cuando NO hay nada conseguido en el
  // grupo (colecciones con currentTier=null o hitos/rachas no unlocked).
  const muted = isCollection ? !currentTier : !unlocked;

  return (
    <div
      className={`
        group relative aspect-square overflow-hidden rounded-lg
        border ${borderClass}
        bg-white/[0.04] p-2
        ${muted ? "opacity-55" : ""}
        transition hover:opacity-100 hover:border-accent/70
      `}
      title={`${title} — ${description}`}
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5">
        <BadgeIcon achievement={achievement} muted={muted} />

        {/* Etiqueta de estado */}
        {isCollection ? (
          currentTier ? (
            <span className={`text-[9px] uppercase tracking-[0.18em] font-semibold ${tierColors(currentTier).text}`}>
              {currentTier}
            </span>
          ) : (
            <span className="text-[9px] uppercase tracking-[0.18em] text-muted">
              {progress.current}/{progress.total}
            </span>
          )
        ) : null}

        {/* Barra de progreso: en colecciones siempre la mostramos
            (incluso con tier conseguido, indica el avance al siguiente).
            En unlocked total (sin nextTier) la ocultamos. */}
        {(!unlocked || (isCollection && nextTier)) && (
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
