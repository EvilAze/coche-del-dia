// src/components/PublicProfile.jsx
// Modal read-only con el perfil de OTRO usuario (no el actual).
// Es el GEMELO de MyStats: comparte el mismo carnet premium (avatar + nick +
// tier + hairline de oro + ficha de specs), pero adaptado a "ver a otro":
//   - Sin email (privado, no se expone).
//   - Sin botón Sign out, sin idioma, sin "puertas" a Garaje/Ranking/Logros
//     (esas navegan a TUS secciones; en un perfil ajeno no aplican).
//   - Las medallas se muestran INLINE (no hay adónde navegar): SOLO las
//     conseguidas, sin progreso pendiente (eso es info personal). Si no
//     tiene ninguna, mensaje amable.
//
// Datos vienen de la RPC `get_public_profile` (ver scripts/supabase-
// public-profile-rpc.sql). Solo expone campos que ya son públicos en
// el leaderboard + lista de coches ganados.

import { useEffect, useMemo, useState } from "react";
import { useT, getLocalizedCountry } from "../i18n";
import { getPublicProfile } from "../lib/statsService";
import { loadCatalog } from "../data/catalog";
import { computeAchievements } from "../lib/achievements";
import { collectorTier } from "../lib/collectionTier";
import { useEscape } from "../hooks/useEscape";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";
import AchievementIcon from "./AchievementIcons";
import PodiumMedals from "./PodiumMedals";

// ── Iconos line-art (stroke currentColor) ────────────────────────────────
// Réplica del set de MyStats: el carnet público habla el mismo idioma de
// iconos que el Perfil propio (NO emoji, cross-platform). Heredan el color
// del padre vía currentColor; el tamaño vía className.
const ICO = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function FlameIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <path d="M12 3c-1 4.5-6 7-6 12a6 6 0 0 0 12 0c0-5-5-7.5-6-12z" />
      <path d="M12 10.5c-.5 2.5-3 4-3 7a3 3 0 0 0 6 0c0-3-2.5-4.5-3-7z" strokeWidth="1.2" />
    </svg>
  );
}

function CrownIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <path d="M4 8l4 3.5 4-6.5 4 6.5 4-3.5v9.5H4z" />
      <path d="M4 17.5h16" strokeWidth="1.2" />
    </svg>
  );
}

function CarIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <path d="M5 11l1.6-4A2 2 0 0 1 8.5 5.7h7a2 2 0 0 1 1.9 1.3L19 11" />
      <path d="M4 11h16v5H4z" />
      <circle cx="7.5" cy="16.5" r="1.6" />
      <circle cx="16.5" cy="16.5" r="1.6" />
    </svg>
  );
}

function MedalIcon({ className = "h-[18px] w-[18px]" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...ICO} aria-hidden="true">
      <circle cx="12" cy="14" r="6" />
      <path d="M9 9 6.5 3.5M15 9l2.5-5.5" />
    </svg>
  );
}

// Avatar: réplica EXACTA del de MyStats (hilo visual entre el perfil propio y
// el público). El comentario ya decía "idéntico a MyStats", pero no lo era: se
// quedó con el degradado menta del tema anterior mientras MyStats migraba a
// papel + filete de tinta, así que los dos perfiles parecían de apps distintas.
function Avatar({ initial }) {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-tinta bg-papel-2">
      <span className="text-xl font-bold text-rojo">{initial}</span>
    </div>
  );
}

// Fila de la ficha de specs: icono + etiqueta a la izquierda, valor a la
// derecha. Mismo patrón que MyStats — lee como hoja de specs del carnet, no
// como KPI suelto. El color del valor codifica semántica de marca: oro para
// lo premium (racha/máxima/puntos), menta para el "acierto" (victorias).
function FichaRow({ icon, label, value, valueClass = "text-foreground", last = false }) {
  return (
    <div
      className={`flex items-center justify-between py-2.5 ${
        last ? "" : "border-b border-border-strong/60"
      }`}
    >
      <span className="flex items-center gap-2.5 text-sm text-foreground/85">
        {icon}
        {label}
      </span>
      <span className={`text-base font-bold tabular-nums ${valueClass}`}>{value}</span>
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
    .replace(/[\u0300-\u036f]/g, "")
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
          // Si el otro usuario tenía oro en una marca antes de que
          // ampliáramos el catálogo, terceros lo siguen viendo en oro.
          persistedUnlocks: profile?.achievementsUnlocked || {},
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

  const stats = state.data?.stats;
  const nickname =
    state.data?.profile?.display_name || t("publicProfile.noNickname");
  const initial = (nickname.trim()[0] || "?").toUpperCase();
  const onStreak = (stats?.current_streak ?? 0) > 0;

  // Tier global de coleccionista derivado del nº de coches ganados (mismo
  // hilo de nivel que el Garaje y el Perfil propio). No viene de la RPC: lo
  // calculamos de wonCarIds, que sí es público, con el helper compartido.
  const tier = collectorTier(state.data?.wonCarIds?.length || 0);
  const tierLabel = tier.tier ? tier.label?.[locale] || tier.label?.es : null;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={t("publicProfile.title")}
      backdropClassName="modal-scrim fixed inset-0 z-[80] flex items-center justify-center px-4"
      panelClassName="modal-panel-flat flex max-h-[90vh] w-full max-w-sm flex-col p-5 overflow-hidden"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("publicProfile.title")}
        </h2>
        <CloseButton onClick={onClose} />
      </div>

      {state.loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : state.error ? (
        <p className="text-sm text-red-400">{state.error}</p>
      ) : (
        <>
          {/* Carnet: identidad + ficha de specs en un solo objeto premium,
              gemelo del carnet del Perfil propio. */}
          <div className="relative overflow-hidden rounded-2xl border border-gold/20 bg-bg-tertiary p-4">
            {/* Hairline de oro: detalle premium discreto. */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-oro-viejo/60 to-transparent" />

            <div className="flex items-center gap-3">
              <Avatar initial={initial} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-bold text-foreground">{nickname}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  {t("publicProfile.publicLabel")}
                </p>
              </div>
              {tierLabel && (
                <span className="shrink-0 rounded-full border border-gold/35 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-gold">
                  {tierLabel}
                </span>
              )}
            </div>

            {/* Ficha de specs: racha · máxima · aciertos · puntos. */}
            <div className="mt-3 border-t border-border pt-1">
              <FichaRow
                icon={
                  <span className={onStreak ? "text-gold" : "text-muted-foreground"}>
                    <FlameIcon />
                  </span>
                }
                label={t("myStats.statStreak")}
                value={stats?.current_streak ?? 0}
                valueClass={onStreak ? "text-gold" : "text-muted-foreground"}
              />
              <FichaRow
                icon={
                  <span className="text-gold">
                    <CrownIcon />
                  </span>
                }
                label={t("myStats.statMaxStreak")}
                value={stats?.max_streak ?? 0}
                valueClass="text-gold"
              />
              <FichaRow
                icon={
                  <span className="text-mint">
                    <CarIcon />
                  </span>
                }
                label={t("myStats.statWins")}
                value={stats?.total_wins ?? 0}
                valueClass="text-mint"
              />
              <FichaRow
                last
                icon={
                  <span className="text-gold">
                    <MedalIcon />
                  </span>
                }
                label={t("publicProfile.statPoints")}
                value={stats?.total_points ?? 0}
                valueClass="text-gold"
              />
            </div>
          </div>

          <div className="-mx-5 mt-5 flex-1 overflow-y-auto border-t border-border px-5 pt-4">
            {/* Podios mensuales (oro/plata/bronce). Solo se renderiza si tiene
                alguno; el wrapper se colapsa con empty:hidden. */}
            <div className="mb-4 empty:hidden">
              <PodiumMedals userId={userId} />
            </div>

            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-foreground">
                {t("publicProfile.medalsTitle")}
              </h3>
              <span className="text-xs tabular-nums text-muted-foreground">
                {visibleAchievements.length}
              </span>
            </div>

            {visibleAchievements.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("publicProfile.noMedalsYet")}
              </p>
            ) : (
              <div className="space-y-4">
                {groups.map(({ category, items }) => (
                  <section key={category}>
                    <h4 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
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

  // Tiers por token (ver PodiumMedals): plata y bronce iban con paleta cruda
  // de Tailwind, que no sigue al tema y desaparecía sobre el papel del día.
  const borderClass =
    tierForBorder === "gold"
      ? "border-gold/60"
      : tierForBorder === "silver"
      ? "border-plata/60"
      : tierForBorder === "bronze"
      ? "border-bronce/60"
      : "border-rojo/50";
  const labelClass =
    tierForBorder === "gold"
      ? "text-gold"
      : tierForBorder === "silver"
      ? "text-plata"
      : tierForBorder === "bronze"
      ? "text-bronce"
      : "text-rojo";

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
  } else if (icon.kind === "svg") {
    iconNode = (
      <AchievementIcon
        name={icon.name}
        repeat={icon.repeat || 1}
        size="h-6 w-6"
      />
    );
  } else {
    iconNode = (
      <span className="font-display text-2xl leading-none">{icon.value || "?"}</span>
    );
  }

  return (
    <div
      className={`group relative aspect-square overflow-hidden rounded-lg border ${borderClass} bg-bg-tertiary p-2`}
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
