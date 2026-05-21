// src/components/PublicProfile.jsx
// Modal read-only con el perfil de OTRO usuario (no el actual).
// Reutiliza la misma estética de MyStats pero:
//   - Sin email (privado, no se expone).
//   - Sin botón Sign out (no eres tú).
//   - Logros: SOLO los conseguidos. No mostramos progreso pendiente
//     (eso es info personal). Si no tiene ninguno, mensaje amable.
//
// Datos vienen de la RPC `get_public_profile` (ver scripts/supabase-
// public-profile-rpc.sql). Solo expone campos que ya son públicos en
// el leaderboard + lista de coches ganados.

import { useEffect, useMemo, useState } from "react";
import { useT, getLocalizedCountry } from "../i18n";
import { getPublicProfile } from "../hooks/useStats";
import { loadCatalog } from "../data/catalog";
import { computeAchievements } from "../lib/achievements";
import { useEscape } from "../hooks/useEscape";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-center">
      <div className="font-display text-2xl text-accent">{value ?? 0}</div>
      <div className="mt-1 text-[9px] uppercase tracking-widest text-muted">
        {label}
      </div>
    </div>
  );
}

// Slugs idénticos a Garage.jsx y Achievements.jsx — claves para que los
// logos de marca y banderas resuelvan correctamente.
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

export default function PublicProfile({ open, onClose, userId }) {
  const { t, locale } = useT();
  const [state, setState] = useState({ loading: true, data: null, error: "" });

  useEscape(open, onClose);

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    setState({ loading: true, data: null, error: "" });

    Promise.all([getPublicProfile(userId), loadCatalog()])
      .then(([profile, catalog]) => {
        if (cancelled) return;
        const achievements = computeAchievements({
          cars: catalog?.cars || [],
          wonCarIds: profile?.wonCarIds || [],
          stats: profile?.stats || {},
        });
        setState({
          loading: false,
          data: { ...profile, achievements },
          error: "",
        });
      })
      .catch((err) => {
        console.error("[PublicProfile]", err);
        if (cancelled) return;
        // Detectamos el caso específico de "RPC no existe" para dar un
        // mensaje útil en dev: la causa más común es haber olvidado
        // ejecutar scripts/supabase-public-profile-rpc.sql en Supabase.
        const msg = String(err?.message || "").toLowerCase();
        const rpcMissing =
          msg.includes("function") &&
          (msg.includes("does not exist") || msg.includes("not found"));
        setState({
          loading: false,
          data: null,
          error: rpcMissing
            ? t("publicProfile.errorRpcMissing")
            : t("publicProfile.errorLoad"),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [open, userId, t]);

  // Filtramos los logros que vamos a mostrar:
  //   - Colecciones (marca/país): solo si tienen currentTier (al menos
  //     un tier conseguido). Ocultamos las que aún no han iniciado.
  //   - Hitos / rachas: solo los unlocked.
  const visibleAchievements = useMemo(() => {
    const items = state.data?.achievements || [];
    return items.filter((a) => {
      if (Array.isArray(a.tiers) && a.tiers.length > 0) {
        return !!a.currentTier;
      }
      return !!a.unlocked;
    });
  }, [state.data]);

  // Agrupar visualmente por categoría, mismo orden que Achievements.jsx.
  const groups = useMemo(() => {
    const map = new Map();
    for (const a of visibleAchievements) {
      if (!map.has(a.category)) map.set(a.category, []);
      map.get(a.category).push(a);
    }
    for (const [category, arr] of map.entries()) {
      if (category === "milestone" || category === "streak") {
        arr.sort((a, b) => a.progress.total - b.progress.total);
      } else {
        arr.sort((a, b) => {
          if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
          // Dentro de las que tienen al menos un tier, oro primero.
          const tierRank = { gold: 0, silver: 1, bronze: 2 };
          const ra = tierRank[a.currentTier] ?? 99;
          const rb = tierRank[b.currentTier] ?? 99;
          if (ra !== rb) return ra - rb;
          return String(a.group).localeCompare(String(b.group), "es");
        });
      }
    }
    return ["milestone", "streak", "brand", "country"]
      .filter((c) => map.has(c))
      .map((c) => ({ category: c, items: map.get(c) }));
  }, [visibleAchievements]);

  const nickname =
    state.data?.profile?.display_name || t("publicProfile.noNickname");

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      backdropClassName="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      panelClassName="flex max-h-[90vh] w-full max-w-sm flex-col rounded-2xl border border-white/10 bg-[#111113] p-5 shadow-2xl overflow-hidden"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-2xl tracking-widest text-white">
          {t("publicProfile.title")}
        </h2>
        <CloseButton onClick={onClose} />
      </div>

      {state.loading ? (
        <p className="text-sm text-muted">{t("common.loading")}</p>
      ) : state.error ? (
        <p className="text-sm text-red-400">{state.error}</p>
      ) : (
        <>
          <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <p className="truncate text-2xl font-bold text-white">{nickname}</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-muted">
              {t("publicProfile.publicLabel")}
            </p>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            <StatCard
              label={t("myStats.statStreak")}
              value={state.data?.stats?.current_streak}
            />
            <StatCard
              label={t("myStats.statMaxStreak")}
              value={state.data?.stats?.max_streak}
            />
            <StatCard
              label={t("myStats.statWins")}
              value={state.data?.stats?.total_wins}
            />
            <StatCard
              label={t("publicProfile.statPoints")}
              value={state.data?.stats?.total_points}
            />
          </div>

          <div className="-mx-5 mt-5 flex-1 overflow-y-auto border-t border-white/10 px-5 pt-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-base tracking-widest text-white">
                {t("publicProfile.medalsTitle")}
              </h3>
              <span className="text-xs tabular-nums text-muted">
                {visibleAchievements.length}
              </span>
            </div>

            {visibleAchievements.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                {t("publicProfile.noMedalsYet")}
              </p>
            ) : (
              <div className="space-y-4">
                {groups.map(({ category, items }) => (
                  <section key={category}>
                    <h4 className="mb-2 text-[10px] uppercase tracking-[0.22em] text-accent">
                      {t(`achievements.category.${category}`)}
                    </h4>
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                      {items.map((a) => (
                        <PublicBadge key={a.id} achievement={a} locale={locale} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </ModalShell>
  );
}

// Versión simplificada del Badge: solo estado conseguido, sin barra de
// progreso (lo no conseguido no se muestra aquí), sin etiqueta "X/Y".
function PublicBadge({ achievement, locale }) {
  const { icon, currentTier, tiers, group } = achievement;
  const isCollection = Array.isArray(tiers) && tiers.length > 0;
  const tierForBorder = isCollection ? currentTier || "gold" : "gold";

  const borderClass =
    tierForBorder === "gold"
      ? "border-yellow-300/70"
      : tierForBorder === "silver"
      ? "border-zinc-300/60"
      : tierForBorder === "bronze"
      ? "border-amber-700/60"
      : "border-accent/60";
  const labelClass =
    tierForBorder === "gold"
      ? "text-yellow-300"
      : tierForBorder === "silver"
      ? "text-zinc-300"
      : tierForBorder === "bronze"
      ? "text-amber-600"
      : "text-accent";

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

  let iconNode;
  if (icon.kind === "brand") {
    iconNode = (
      <img
        src={`/brands/${brandSlug(icon.value)}.png`}
        alt={group || ""}
        draggable={false}
        loading="lazy"
        className="h-8 w-8 object-contain"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    );
  } else if (icon.kind === "country") {
    iconNode = (
      <img
        src={`/flags/${countrySlug(icon.value)}.jpg`}
        alt={group ? getLocalizedCountry(group) : ""}
        draggable={false}
        loading="lazy"
        className="h-8 w-8 rounded-sm object-cover"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    );
  } else {
    iconNode = (
      <span className="font-display text-2xl leading-none">{icon.value}</span>
    );
  }

  return (
    <div
      className={`group relative aspect-square overflow-hidden rounded-lg border ${borderClass} bg-white/[0.04] p-2`}
      title={`${title} — ${description}`}
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-1">
        {iconNode}
        {isCollection && currentTier && (
          <span className={`text-[8px] uppercase tracking-[0.18em] font-semibold ${labelClass}`}>
            {currentTier}
          </span>
        )}
      </div>
    </div>
  );
}
