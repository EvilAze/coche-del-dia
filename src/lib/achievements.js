// api/_lib/achievements.js
// Catálogo y cómputo de logros (achievements). Diseño clave:
//
//   - TODO se deriva de datos existentes (cars + user_guesses + stats).
//     NO hay tabla user_achievements. Si la BD se rebobina o se cambia
//     la lógica, los logros se recalculan al vuelo en la próxima request
//     sin pérdida de información ni necesidad de migración.
//
//   - Las definiciones de marca/país son PARAMÉTRICAS al catálogo: cuando
//     el admin añade una marca nueva, automáticamente existe el logro
//     "Coleccionista de [marca]" sin tocar este archivo.
//
//   - Solo categorías "objetivas y cuantitativas" en v1. Logros de
//     comportamiento subjetivo (p.ej. "comparte 5 partidas") quedan para
//     una v2 cuando hayamos visto cómo reacciona la gente.

// ---------- Tiers para colecciones --------------------------------------

const COUNTRY_TIERS = [
  { tier: "bronze", pct: 0.25, label: { es: "Bronce", en: "Bronze" } },
  { tier: "silver", pct: 0.5, label: { es: "Plata", en: "Silver" } },
  { tier: "gold",   pct: 1.0, label: { es: "Oro",    en: "Gold" } },
];

const BRAND_TIERS = [
  // Saltamos bronce en marcas porque suelen tener pocos coches; bronze
  // al 25% se desbloquearía casi gratis. Dos tiers basta.
  { tier: "silver", pct: 0.5, label: { es: "Plata", en: "Silver" } },
  { tier: "gold",   pct: 1.0, label: { es: "Oro",    en: "Gold" } },
];

// ---------- Hitos fijos --------------------------------------------------

const MILESTONE_THRESHOLDS = [
  { id: "first",  count: 1,   icon: "🚗", title: { es: "Primer coche",   en: "First car" },         desc: { es: "Desbloquea tu primer coche.",  en: "Unlock your first car." } },
  { id: "small",  count: 10,  icon: "🅿️", title: { es: "Garaje pequeño", en: "Small garage" },      desc: { es: "Desbloquea 10 coches.",        en: "Unlock 10 cars." } },
  { id: "shop",   count: 25,  icon: "🏬", title: { es: "Concesionario",  en: "Dealership" },        desc: { es: "Desbloquea 25 coches.",        en: "Unlock 25 cars." } },
  { id: "museum", count: 50,  icon: "🏛️", title: { es: "Museo",          en: "Museum" },            desc: { es: "Desbloquea 50 coches.",        en: "Unlock 50 cars." } },
  { id: "icon",   count: 100, icon: "👑", title: { es: "Garaje icónico", en: "Iconic garage" },     desc: { es: "Desbloquea 100 coches.",       en: "Unlock 100 cars." } },
];

const STREAK_THRESHOLDS = [
  { id: 7,   icon: "🔥",   title: { es: "Constancia",  en: "Steady" },     desc: { es: "Racha de 7 días.",   en: "7-day streak." } },
  { id: 30,  icon: "🔥🔥", title: { es: "Disciplina",  en: "Disciplined" }, desc: { es: "Racha de 30 días.",  en: "30-day streak." } },
  { id: 100, icon: "🔥🔥🔥", title: { es: "Leyenda",   en: "Legend" },     desc: { es: "Racha de 100 días.", en: "100-day streak." } },
];

// ---------- Helpers ------------------------------------------------------

/**
 * Slug seguro para nombre de marca/país. Tiene que coincidir con la
 * convención que ya usa el frontend para resolver /public/brands/<slug>.png
 * y /public/flags/<slug>.svg.
 */
function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * Devuelve los tiers QUE APLICAN dada la talla del grupo, sin duplicar
 * umbrales absolutos. Si varios tiers (p.ej. silver y gold) caen sobre
 * el MISMO valor requerido (típico en grupos con 1-2 elementos),
 * conservamos SIEMPRE el tier más alto — la lógica es: "tener 1 de 1
 * coches no es plata, es oro". El bug previo elegía el primero (más
 * bajo) y por eso una marca con 1 coche aparecía como SILVER.
 *
 * `tiers` debe venir ordenado ascendente por pct (gold el último).
 */
function effectiveTiers(tiers, total) {
  // Mapa required → tier. Al sobrescribir al iterar en orden ascendente
  // de pct, el tier más alto siempre gana en empate de umbral.
  const byRequired = new Map();
  for (const t of tiers) {
    const required = Math.max(1, Math.ceil(total * t.pct));
    if (required <= total) {
      byRequired.set(required, { ...t, required });
    }
  }
  return [...byRequired.values()].sort((a, b) => a.required - b.required);
}

// ---------- Cómputo principal -------------------------------------------

// Ranking interno de tiers para el merge "max(persisted, computed)".
// gold > silver > bronze > nada.
const TIER_RANK = { bronze: 1, silver: 2, gold: 3 };
function tierRank(name) {
  return TIER_RANK[name] || 0;
}

/**
 * @param {object} input
 * @param {Array<{id:string, marca:string, pais:string}>} input.cars Catálogo completo.
 * @param {Array<string>} input.wonCarIds car_ids únicos ganados por el usuario.
 * @param {{current_streak?:number, max_streak?:number, total_wins?:number}|null} input.stats
 * @param {Record<string, string|boolean>} [input.persistedUnlocks] Snapshot
 *   persistido de desbloqueos previos. Mapa achievementId -> tier (para
 *   colecciones) o boolean true (para hitos/rachas). Si está presente, los
 *   logros NUNCA regresan: el tier final es max(persisted, computed). Esto
 *   protege al usuario de "perder" medallas cuando el admin amplía el
 *   catálogo (y los umbrales porcentuales se mueven).
 * @returns {Array} Lista de logros. Las colecciones (marca/país) emiten
 *   UNA entrada por grupo con todos los tiers embebidos (currentTier +
 *   nextTier). Hitos y rachas emiten una entrada por umbral individual.
 */
export function computeAchievements({ cars, wonCarIds, stats, persistedUnlocks }) {
  const wonSet = new Set(wonCarIds || []);
  const persisted = persistedUnlocks || {};
  const out = [];

  // Helper: para una colección (marca o país), construye UNA tarjeta con
  // todos los tiers. currentTier = el más alto desbloqueado (o null).
  // nextTier = el siguiente por desbloquear (o null si completo).
  function buildCollectionAchievement({
    category, group, slug, total, wonCount, tierDefs, iconKind, iconValue,
    labelSingular, labelPlural,
  }) {
    const id = `${category}_${slug}`;
    const persistedTier = typeof persisted[id] === "string" ? persisted[id] : null;
    const persistedRank = tierRank(persistedTier);

    // Cada tier se marca como achieved si:
    //   - el usuario tiene wonCount >= required (estado natural), O
    //   - el tier es <= al persistido (freeze: el oro de ayer sigue siendo oro)
    const tiers = effectiveTiers(tierDefs, total).map((t) => ({
      tier: t.tier,
      label: t.label,
      required: t.required,
      achieved: wonCount >= t.required || tierRank(t.tier) <= persistedRank,
    }));
    const achievedTiers = tiers.filter((t) => t.achieved);
    const currentTierObj = achievedTiers[achievedTiers.length - 1] || null;
    const nextTier = tiers.find((t) => !t.achieved) || null;
    const fullyDone = tiers.length > 0 && tiers.every((t) => t.achieved);

    // El nombre del tier "final" puede ser persistido si está por encima
    // de cualquier tier definido en el catálogo actual (caso edge: el
    // persistido es gold pero el catálogo creció tanto que ni siquiera
    // existe ya un tier llamado igual con el wonCount actual). En la
    // práctica, como persistimos solo nombres canónicos (bronze/silver/
    // gold), y los tier names se mantienen, currentTierObj cubre el caso.
    const effectiveTierName = currentTierObj?.tier
      || (persistedTier && tierRank(persistedTier) > 0 ? persistedTier : null);

    // Etiqueta amigable del tier efectivo (si es persistido y no figura en
    // tiers, buscamos su label en tierDefs).
    const effectiveTierLabel =
      currentTierObj?.label
      || tierDefs.find((d) => d.tier === effectiveTierName)?.label
      || null;

    // Para la barra de progreso: si no hay siguiente tier, mostramos
    // wonCount/total absoluto. Si lo hay, progreso hacia ese siguiente.
    const progress = nextTier
      ? { current: Math.min(wonCount, nextTier.required), total: nextTier.required }
      : { current: wonCount, total };

    return {
      id,
      category,
      group,
      icon: { kind: iconKind, value: iconValue },
      tiers,                              // array completo de tiers
      currentTier: effectiveTierName,
      nextTier: nextTier
        ? { tier: nextTier.tier, required: nextTier.required, label: nextTier.label }
        : null,
      total,
      wonCount,
      unlocked: fullyDone,
      // Flag útil para UI/futuro: ¿el currentTier viene de persistencia
      // y NO del estado actual del catálogo? Sirve para distinguir
      // visualmente medallas "frozen" (catálogo creció) si algún día
      // queremos mostrarlo. Hoy no se usa, pero queda emitido.
      frozenFromCatalogGrowth:
        persistedRank > 0 && wonCount < (currentTierObj?.required ?? 0),
      progress,
      // Título/descripción dinámicos según estado:
      title: effectiveTierName
        ? {
            es: `${effectiveTierLabel?.es || effectiveTierName} — ${group}`,
            en: `${effectiveTierLabel?.en || effectiveTierName} — ${group}`,
          }
        : {
            es: `${group}`,
            en: `${group}`,
          },
      description: nextTier
        ? {
            es: `Tienes ${wonCount} de ${total} ${labelPlural || group}. Siguiente: ${nextTier.label.es} (${nextTier.required}).`,
            en: `You have ${wonCount} of ${total} ${labelPlural || group}. Next: ${nextTier.label.en} (${nextTier.required}).`,
          }
        : {
            es: `Colección completa de ${labelPlural || group}.`,
            en: `Full ${labelSingular || group} collection.`,
          },
    };
  }

  // ===== 1) Coleccionista por MARCA =====
  const byBrand = new Map();
  for (const c of cars || []) {
    const brand = (c.marca || "").trim();
    if (!brand) continue;
    const entry = byBrand.get(brand) || { total: 0, wonCount: 0 };
    entry.total += 1;
    if (wonSet.has(c.id)) entry.wonCount += 1;
    byBrand.set(brand, entry);
  }
  for (const [brand, { total, wonCount }] of [...byBrand.entries()].sort()) {
    out.push(
      buildCollectionAchievement({
        category: "brand",
        group: brand,
        slug: slugify(brand),
        total,
        wonCount,
        tierDefs: BRAND_TIERS,
        iconKind: "brand",
        iconValue: brand,
        labelSingular: brand,
        labelPlural: brand,
      })
    );
  }

  // ===== 2) Coleccionista por PAÍS =====
  const byCountry = new Map();
  for (const c of cars || []) {
    const country = (c.pais || "").trim();
    if (!country) continue;
    const entry = byCountry.get(country) || { total: 0, wonCount: 0 };
    entry.total += 1;
    if (wonSet.has(c.id)) entry.wonCount += 1;
    byCountry.set(country, entry);
  }
  for (const [country, { total, wonCount }] of [...byCountry.entries()].sort()) {
    out.push(
      buildCollectionAchievement({
        category: "country",
        group: country,
        slug: slugify(country),
        total,
        wonCount,
        tierDefs: COUNTRY_TIERS,
        iconKind: "country",
        iconValue: country,
        labelSingular: country,
        labelPlural: country,
      })
    );
  }

  // ===== 3) Hitos de progreso =====
  const totalUnlocked = wonSet.size;
  for (const m of MILESTONE_THRESHOLDS) {
    const id = `milestone_${m.id}`;
    const naturallyUnlocked = totalUnlocked >= m.count;
    const persistedUnlocked = persisted[id] === true;
    out.push({
      id,
      category: "milestone",
      group: null,
      tier: null,
      icon: { kind: "emoji", value: m.icon },
      title: m.title,
      description: m.desc,
      unlocked: naturallyUnlocked || persistedUnlocked,
      frozenFromCatalogGrowth: persistedUnlocked && !naturallyUnlocked,
      progress: { current: Math.min(totalUnlocked, m.count), total: m.count },
    });
  }

  // ===== 4) Constancia (rachas) =====
  const maxStreak = Math.max(0, Number(stats?.max_streak || 0));
  for (const s of STREAK_THRESHOLDS) {
    const idStreak = `streak_${s.id}`;
    const naturallyUnlockedS = maxStreak >= s.id;
    const persistedUnlockedS = persisted[idStreak] === true;
    out.push({
      id: idStreak,
      category: "streak",
      group: null,
      tier: null,
      icon: { kind: "emoji", value: s.icon },
      title: s.title,
      description: s.desc,
      unlocked: naturallyUnlockedS || persistedUnlockedS,
      frozenFromCatalogGrowth: persistedUnlockedS && !naturallyUnlockedS,
      progress: { current: Math.min(maxStreak, s.id), total: s.id },
    });
  }

  return out;
}
