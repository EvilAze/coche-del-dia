// src/components/PublicProfile.jsx
// Modal read-only con el perfil de OTRO usuario (no el actual).
// Es el GEMELO de MyStats: mismo carnet (cabecera + cifra + ficha de specs),
// pero adaptado a "ver a otro":
//   - Sin email (privado, no se expone).
//   - Sin botón Sign out, sin idioma, sin "puertas" a Archivo/Ranking/Logros
//     (esas navegan a TUS secciones; en un perfil ajeno no aplican).
//   - Las medallas se muestran INLINE (no hay adónde navegar): SOLO las
//     conseguidas, sin progreso pendiente (eso es info personal). Si no
//     tiene ninguna, mensaje amable.
//
// El carnet ya NO se dibuja aquí: vive en components/carnet/, compartido con
// MyStats. Los dos perfiles se despegaron una vez (este se quedó con el avatar
// de degradado menta del tema anterior mientras el propio migraba a papel) y la
// causa era tener dos copias del mismo objeto. Ahora es una.
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
import Carnet, { CarnetHead, CarnetCifra, FichaRow, FichaCifra } from "./carnet/Carnet";
import { FlameIcon, CrownIcon, CarIcon } from "./carnet/icons";

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

  const cargando = state.loading;
  const stats = state.data?.stats;
  const nickname =
    state.data?.profile?.display_name || t("publicProfile.noNickname");
  const onStreak = (stats?.current_streak ?? 0) > 0;
  const maxStreak = stats?.max_streak ?? 0;

  // Tier global de coleccionista derivado del nº de coches ganados (mismo
  // hilo de nivel que el Archivo y el Perfil propio). No viene de la RPC: lo
  // calculamos de wonCarIds, que sí es público, con el helper compartido.
  const tier = collectorTier(state.data?.wonCarIds?.length || 0);
  const tierLabel = tier.tier ? tier.label?.[locale] || tier.label?.es : null;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      label={t("publicProfile.title")}
      backdropClassName="modal-scrim fixed inset-0 z-[80] flex items-center justify-center px-4"
      panelClassName="modal-panel-flat flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden p-5"
    >
      {state.error ? (
        <>
          <div className="mb-3 flex items-start justify-between gap-2">
            <p className="pm-kicker">{t("publicProfile.publicLabel")}</p>
            <CloseButton onClick={onClose} className="-mr-2 -mt-2" />
          </div>
          <p className="text-sm text-rojo">{state.error}</p>
        </>
      ) : (
        <>
          {/* El carnet hace de cabecera del modal, igual que en MyStats: el
              título «Perfil» que había encima repetía lo que dice el propio
              carnet y se comía 60px de alto. */}
          <Carnet className="shrink-0">
            <CarnetHead
              kicker={t("publicProfile.publicLabel")}
              nombre={nickname}
              cargando={cargando}
              trailing={<CloseButton onClick={onClose} className="-mr-2 -mt-2" />}
            />

            {/* Los puntos son la cifra del carnet (aquí no hay puesto: la RPC
                pública no expone la posición en la clasificación). */}
            <CarnetCifra
              puntos={cargando ? "—" : (stats?.total_points ?? 0)}
              puntosLabel={t("publicProfile.statPoints")}
              sello={
                tierLabel && (
                  <span className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="pm-label">{t("myStats.tierLabel")}</span>
                    <span className="pm-sello pm-sello--oro">{tierLabel}</span>
                  </span>
                )
              }
            />

            {/* Ficha de specs: racha · máxima · aciertos. */}
            <div className="mt-3 border-t border-border pt-1">
              <FichaRow
                icon={
                  <span className={onStreak ? "text-gold" : "text-muted-foreground"}>
                    <FlameIcon />
                  </span>
                }
                label={t("myStats.statStreak")}
              >
                <FichaCifra
                  value={cargando ? "—" : (stats?.current_streak ?? 0)}
                  premium={onStreak}
                />
              </FichaRow>

              <FichaRow
                icon={
                  <span className={maxStreak > 0 ? "text-gold" : "text-muted-foreground"}>
                    <CrownIcon />
                  </span>
                }
                label={t("myStats.statMaxStreak")}
              >
                <FichaCifra value={cargando ? "—" : maxStreak} premium={maxStreak > 0} />
              </FichaRow>

              <FichaRow
                last
                icon={
                  <span className="text-rojo">
                    <CarIcon />
                  </span>
                }
                label={t("myStats.statWins")}
              >
                <span className="text-base font-bold tabular-nums text-rojo">
                  {cargando ? "—" : (stats?.total_wins ?? 0)}
                </span>
              </FichaRow>
            </div>
          </Carnet>

          {cargando ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : (
            <div className="scrollbar-premium -mx-5 min-h-0 flex-1 overflow-y-auto px-5 pt-4">
              {/* Podios de temporada y de mes. Solo se renderiza si tiene
                  alguno; el wrapper se colapsa con empty:hidden. */}
              <div className="mb-4 empty:hidden">
                <PodiumMedals userId={userId} />
              </div>

              <div className="mb-3 flex items-center justify-between">
                <h3 className="pm-label">{t("publicProfile.medalsTitle")}</h3>
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
          )}
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
        className="h-8 w-8 rounded-none object-cover"
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
      className={`group relative aspect-square overflow-hidden rounded-none border ${borderClass} bg-bg-tertiary p-2`}
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
