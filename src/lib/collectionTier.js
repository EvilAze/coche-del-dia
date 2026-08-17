// src/lib/collectionTier.js
// Tier de una colección (marca/país) derivado de unlocked/total, para
// pintar la medalla bronce/plata/oro en las tarjetas del Garaje.
//
// Estos umbrales eran una réplica de los que usaba el sistema de logros. Al
// retirarse ese sistema, este módulo dejó de ser una copia y pasó a ser LA
// definición: es el progreso de colección de El Archivo (unlocked/total, los
// agregados que ya da /api/garage) y el sello del tier en el carnet. Nada de
// esto es un logro con su modal — es el álbum diciendo por dónde vas.
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

// Color de cada tier. Rediseño «Prensa del motor» (F4): metálicos
// OSCURECIDOS para que lean sobre papel marfil (los originales
// —gold #e8c87a, silver #cfd2d6— eran para fondo grafito y desaparecían
// sobre claro). Siguen evocando oro/plata/bronce, con la profundidad que
// el papel exige (contraste AA).
export const TIER_HEX = {
  bronze: "#8a5a2b",
  silver: "#6f767f",
  gold: "#8a6a12",
};

const TIER_LABEL = {
  bronze: { es: "Bronce", en: "Bronze" },
  silver: { es: "Plata", en: "Silver" },
  gold: { es: "Oro", en: "Gold" },
};

// El nombre del metal, localizado. Existe porque el perfil ajeno imprimía la
// CLAVE INTERNA bajo cada cromo («GOLD», «SILVER») también en español: el mapa
// ya estaba escrito aquí, solo que privado.
export function tierLabel(tier, locale) {
  const label = TIER_LABEL[tier];
  if (!label) return "";
  return label[locale] || label.es;
}

// ── Tier GLOBAL de coleccionista ─────────────────────────────────────────
// A diferencia de countryTier/brandTier (por colección concreta), este es el
// RANGO del jugador en toda la colección, derivado del total de coches
// ganados. Lo mostramos en el carnet del Perfil y en la cabecera del Garaje,
// como hilo conductor de nivel entre ambas pantallas.
//
// Los umbrales (25 y 100) venían de la escalera de hitos de Logros —Plata era
// el hito «Concesionario», Oro el «Salón de la fama»— y estaban aquí para que
// el «Próximo · Plata» del Garaje coincidiera con el hito. Retirados los
// logros, ya no replican nada: son la escalera, sin más. Se conservan tal cual
// a propósito, porque mover un umbral le quita el rango a quien ya lo tenía.
const COLLECTOR_TIERS = [
  { tier: "bronze", min: 1 },
  { tier: "silver", min: 25 },
  { tier: "gold", min: 100 },
];

// Devuelve el tier actual + el siguiente por alcanzar, dado el nº de coches
// ganados. `tier`/`label` son null cuando aún no se ha ganado ningún coche
// (en ese caso `next` apunta a Bronce). `next` es null cuando ya es Oro.
export function collectorTier(wonCount) {
  const n = Math.max(0, Number(wonCount) || 0);
  let current = null;
  let next = null;
  for (const t of COLLECTOR_TIERS) {
    if (n >= t.min) {
      current = t;
    } else {
      next = t;
      break;
    }
  }
  return {
    tier: current?.tier ?? null,
    label: current ? TIER_LABEL[current.tier] : null,
    next: next
      ? { tier: next.tier, label: TIER_LABEL[next.tier], required: next.min }
      : null,
  };
}
