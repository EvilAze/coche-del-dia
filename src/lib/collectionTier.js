// src/lib/collectionTier.js
// Tier de una colección (marca/país) derivado de unlocked/total, para
// pintar la medalla bronce/plata/oro en las tarjetas del Garaje.
//
// Réplica DE SOLO LECTURA de los umbrales de api/_lib/achievements.js
// (COUNTRY_TIERS / BRAND_TIERS). El cómputo "oficial" de logros sigue
// viviendo allí; esto es únicamente para el indicador visual del Garaje,
// que trabaja con los agregados unlocked/total que ya da /api/garage.
//
//   País:  bronce 25% · plata 50% · oro 100%
//   Marca: plata 50% · oro 100%  (sin bronce: marcas con pocos coches
//          desbloquearían bronce casi gratis)

export function countryTier(unlocked, total) {
  if (!total || unlocked <= 0) return null;
  if (unlocked >= total) return "gold";
  if (unlocked >= Math.ceil(total * 0.5)) return "silver";
  if (unlocked >= Math.ceil(total * 0.25)) return "bronze";
  return null;
}

export function brandTier(unlocked, total) {
  if (!total || unlocked <= 0) return null;
  if (unlocked >= total) return "gold";
  if (unlocked >= Math.ceil(total * 0.5)) return "silver";
  return null;
}

// Color de cada tier. El oro usa el accent de marca (#e8c87a).
export const TIER_HEX = {
  bronze: "#c0834a",
  silver: "#cfd2d6",
  gold: "#e8c87a",
};

export const TIER_LABEL = {
  bronze: { es: "Bronce", en: "Bronze" },
  silver: { es: "Plata", en: "Silver" },
  gold: { es: "Oro", en: "Gold" },
};
