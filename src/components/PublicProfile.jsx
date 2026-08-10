// src/components/PublicProfile.jsx
// Modal read-only con el perfil de OTRO usuario (no el actual).
// Es el GEMELO de MyStats: el mismo carnet (cabecera, nombre con sello y banda
// de datos), pero adaptado a "ver a otro":
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
// causa era tener dos copias del mismo objeto. Ahora es una: el mismo documento
// con otras cuatro casillas en la banda —aquí no hay puesto (la RPC pública no
// expone posición), hay aciertos— y con el palmarés debajo.
//
// EL PALMARÉS ERA UNA PARED DE INSIGNIAS: una cuadrícula de cuadrados sueltos,
// cada uno con filete de SU metal al 60%, o sea doce marcos de tres colores
// flotando sobre el papel — el aspecto de «gamificación de aplicación» que el
// resto del juego evita. Encima, la etiqueta del tier se imprimía SIN TRADUCIR
// («GOLD», «SILVER») también en español, porque salía de la clave interna.
// Ahora es una PLANCHA DE CROMOS: la misma rejilla de filetes que las
// portadillas, el metal solo en la palabra de debajo del cromo, y localizado.
//
// Datos vienen de la RPC `get_public_profile` (ver scripts/supabase-
// public-profile-rpc.sql). Solo expone campos que ya son públicos en
// el leaderboard + lista de coches ganados.

import { useEffect, useMemo, useState } from "react";
import { useT, getLocalizedCountry } from "../i18n";
import { getPublicProfile } from "../lib/statsService";
import { loadCatalog } from "../data/catalog";
import { computeAchievements } from "../lib/achievements";
import { collectorTier, tierLabel } from "../lib/collectionTier";
import { useEscape } from "../hooks/useEscape";
import CloseButton from "./CloseButton";
import ModalShell from "./ModalShell";
import AchievementIcon from "./AchievementIcons";
import PodiumMedals from "./PodiumMedals";
import Carnet, {
  CarnetCabecera,
  CarnetNombre,
  CarnetCifras,
  SelloTier,
} from "./carnet/Carnet";

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
  const { t, tn, locale } = useT();
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
  const portadas = state.data?.wonCarIds?.length || 0;

  // Tier global de coleccionista derivado del nº de coches ganados (mismo
  // hilo de nivel que el Archivo y el Perfil propio). No viene de la RPC: lo
  // calculamos de wonCarIds, que sí es público, con el helper compartido.
  const tier = collectorTier(portadas);
  const selloTier = tier.tier ? tier.label?.[locale] || tier.label?.es : null;

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
          <Carnet className="shrink-0" aria-busy={cargando}>
            <CarnetCabecera
              kicker={t("publicProfile.publicLabel")}
              trailing={<CloseButton onClick={onClose} />}
            />

            <CarnetNombre
              nombre={nickname}
              cargando={cargando}
              // La antigüedad («Lector desde…») es del carnet PROPIO: la RPC
              // pública no expone la fecha de alta, y tampoco debería. Aquí el
              // renglón de acreditación lo llena lo único público que dice algo
              // de esta persona como lectora: su archivo.
              apunte={tn("publicProfile.portadas", portadas, { count: portadas })}
              sello={
                <SelloTier
                  tier={tier.tier}
                  label={selloTier}
                  title={t("myStats.tierLabel")}
                />
              }
            />

            {/* La banda: puntos · aciertos · racha · máxima. Sin puesto — la RPC
                pública no expone posición en la clasificación. */}
            <CarnetCifras
              items={[
                {
                  label: t("publicProfile.statPoints"),
                  value: cargando ? "—" : (stats?.total_points ?? 0),
                },
                {
                  label: t("myStats.statWins"),
                  value: cargando ? "—" : (stats?.total_wins ?? 0),
                },
                {
                  label: t("myStats.statStreak"),
                  value: cargando ? "—" : (stats?.current_streak ?? 0),
                  tono: onStreak ? "oro" : "",
                },
                {
                  label: t("myStats.statMaxStreak"),
                  value: cargando ? "—" : maxStreak,
                },
              ]}
            />
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
                      {/* Ladillo de grupo en versalitas de tinta, no en mono
                          rojo: el rojo es «acción/atención» del sistema y aquí
                          no hay nada que atender — son cuatro encabezados
                          seguidos. */}
                      <h4 className="pm-label mb-2">
                        {t(`achievements.category.${category}`)}
                      </h4>
                      <div className="prensa-plancha">
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

// UN CROMO de la plancha: el icono del logro y, debajo, su metal cuando lo
// tiene. Sin filete propio (los pone la plancha) y sin barra de progreso: aquí
// solo se enseña lo conseguido, que lo pendiente de otra persona no es asunto
// de nadie.
function PublicBadge({ achievement, locale }) {
  const { icon, currentTier, tiers, group } = achievement;
  const isCollection = Array.isArray(tiers) && tiers.length > 0;
  // Solo las colecciones tienen metal; un hito o una racha se tiene o no se
  // tiene. Antes TODO se dibujaba con un metal (los hitos, en oro) y el marco
  // dorado acababa siendo el estado por defecto — o sea, ninguno.
  const metal = isCollection ? currentTier || null : null;
  const metalClase =
    metal === "gold" ? "oro" : metal === "silver" ? "plata" : metal === "bronze" ? "bronce" : "";

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
    <div className="prensa-cromo" title={`${title} — ${description}`}>
      {iconNode}
      {/* El metal, EN CASTELLANO. Aquí se imprimía `currentTier` a pelo, o sea
          la clave interna en inglés: un jugador español leía «GOLD» y «SILVER»
          debajo de sus cromos. */}
      {metal && <span className={`et ${metalClase}`}>{tierLabel(metal, locale)}</span>}
    </div>
  );
}
