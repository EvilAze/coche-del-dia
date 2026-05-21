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
 * Devuelve los tiers QUE APLICAN dada la talla del grupo. Si el grupo es
 * tan pequeño que el porcentaje del tier no añade requisito (p.ej. plata
 * = 50% de 2 coches = 1, pero oro = 2 → plata desbloquea con menos que oro).
 * Filtramos tiers cuyo umbral en valor absoluto sería igual o menor que
 * el anterior, para no repetir logros equivalentes.
 */
function effectiveTiers(tiers, total) {
  const out = [];
  let lastRequired = 0;
  for (const t of tiers) {
    const required = Math.max(1, Math.ceil(total * t.pct));
    if (required > lastRequired && required <= total) {
      out.push({ ...t, required });
      lastRequired = required;
    }
  }
  return out;
}

// ---------- Cómputo principal -------------------------------------------

/**
 * @param {object} input
 * @param {Array<{id:string, marca:string, pais:string}>} input.cars Catálogo completo.
 * @param {Array<string>} input.wonCarIds car_ids únicos ganados por el usuario.
 * @param {{current_streak?:number, max_streak?:number, total_wins?:number}|null} input.stats
 * @returns {Array<{
 *   id:string, category:string, group:string|null, tier:string|null,
 *   icon:{kind:string, value:string},
 *   title:{es:string,en:string}, description:{es:string,en:string},
 *   unlocked:boolean, progress:{current:number, total:number}
 * }>}
 */
export function computeAchievements({ cars, wonCarIds, stats }) {
  const wonSet = new Set(wonCarIds || []);
  const out = [];

  // ===== 1) Coleccionista por MARCA =====
  const byBrand = new Map(); // brand -> {total, wonCount}
  for (const c of cars || []) {
    const brand = (c.marca || "").trim();
    if (!brand) continue;
    const entry = byBrand.get(brand) || { total: 0, wonCount: 0 };
    entry.total += 1;
    if (wonSet.has(c.id)) entry.wonCount += 1;
    byBrand.set(brand, entry);
  }
  for (const [brand, { total, wonCount }] of [...byBrand.entries()].sort()) {
    const slug = slugify(brand);
    for (const tier of effectiveTiers(BRAND_TIERS, total)) {
      out.push({
        id: `brand_${slug}_${tier.tier}`,
        category: "brand",
        group: brand,
        tier: tier.tier,
        // value es el NOMBRE crudo de la marca; el componente UI resuelve
        // la ruta del logo con su propio helper (que coincide con
        // la convención de /public/brands/*.png).
        icon: { kind: "brand", value: brand },
        title: {
          es: `Coleccionista ${tier.label.es} — ${brand}`,
          en: `${tier.label.en} Collector — ${brand}`,
        },
        description: {
          es: `Gana ${tier.required} de ${total} ${brand}.`,
          en: `Win ${tier.required} of ${total} ${brand}.`,
        },
        unlocked: wonCount >= tier.required,
        progress: { current: Math.min(wonCount, tier.required), total: tier.required },
      });
    }
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
    const slug = slugify(country);
    for (const tier of effectiveTiers(COUNTRY_TIERS, total)) {
      out.push({
        id: `country_${slug}_${tier.tier}`,
        category: "country",
        group: country,
        tier: tier.tier,
        icon: { kind: "country", value: country },
        title: {
          es: `Coleccionista ${tier.label.es} — ${country}`,
          en: `${tier.label.en} Collector — ${country}`,
        },
        description: {
          es: `Gana ${tier.required} de ${total} de ${country}.`,
          en: `Win ${tier.required} of ${total} from ${country}.`,
        },
        unlocked: wonCount >= tier.required,
        progress: { current: Math.min(wonCount, tier.required), total: tier.required },
      });
    }
  }

  // ===== 3) Hitos de progreso =====
  const totalUnlocked = wonSet.size;
  for (const m of MILESTONE_THRESHOLDS) {
    out.push({
      id: `milestone_${m.id}`,
      category: "milestone",
      group: null,
      tier: null,
      icon: { kind: "emoji", value: m.icon },
      title: m.title,
      description: m.desc,
      unlocked: totalUnlocked >= m.count,
      progress: { current: Math.min(totalUnlocked, m.count), total: m.count },
    });
  }

  // ===== 4) Constancia (rachas) =====
  const maxStreak = Math.max(0, Number(stats?.max_streak || 0));
  for (const s of STREAK_THRESHOLDS) {
    out.push({
      id: `streak_${s.id}`,
      category: "streak",
      group: null,
      tier: null,
      icon: { kind: "emoji", value: s.icon },
      title: s.title,
      description: s.desc,
      unlocked: maxStreak >= s.id,
      progress: { current: Math.min(maxStreak, s.id), total: s.id },
    });
  }

  return out;
}
