import { describe, it, expect } from "vitest";
import {
  computeAchievements,
  buildPersistDiff,
  countDisplayedAchievements,
} from "./achievements";

// Catálogo mínimo: Audi(2), BMW(1), Seat(1) · Alemania(3), España(1).
const cars = [
  { id: "c1", marca: "Audi", pais: "Alemania" },
  { id: "c2", marca: "Audi", pais: "Alemania" },
  { id: "c3", marca: "BMW", pais: "Alemania" },
  { id: "c4", marca: "Seat", pais: "España" },
];

const byId = (items, id) => items.find((a) => a.id === id);

describe("computeAchievements · colección por marca", () => {
  it("BRAND_TIERS: 1 de 2 Audi → plata", () => {
    const items = computeAchievements({ cars, wonCarIds: ["c1"], stats: {} });
    expect(byId(items, "brand_audi").currentTier).toBe("silver");
  });

  it("2 de 2 Audi → oro y unlocked", () => {
    const items = computeAchievements({ cars, wonCarIds: ["c1", "c2"], stats: {} });
    const audi = byId(items, "brand_audi");
    expect(audi.currentTier).toBe("gold");
    expect(audi.unlocked).toBe(true);
  });

  it("0 coches de una marca → sin tier", () => {
    const items = computeAchievements({ cars, wonCarIds: [], stats: {} });
    expect(byId(items, "brand_bmw").currentTier).toBe(null);
  });
});

describe("computeAchievements · hitos y rachas", () => {
  it("milestone_first se desbloquea con 1 coche; small (10) no", () => {
    const items = computeAchievements({ cars, wonCarIds: ["c1"], stats: {} });
    expect(byId(items, "milestone_first").unlocked).toBe(true);
    expect(byId(items, "milestone_small").unlocked).toBe(false);
  });

  it("racha: max_streak 7 desbloquea streak_7 pero no streak_30", () => {
    const items = computeAchievements({ cars, wonCarIds: [], stats: { max_streak: 7 } });
    expect(byId(items, "streak_7").unlocked).toBe(true);
    expect(byId(items, "streak_30").unlocked).toBe(false);
  });

  it("stats ausente no rompe (rachas a 0)", () => {
    const items = computeAchievements({ cars, wonCarIds: [], stats: null });
    expect(byId(items, "streak_7").unlocked).toBe(false);
  });
});

describe("computeAchievements · freeze por crecimiento de catálogo", () => {
  it("persistedUnlocks mantiene el oro aunque ahora se cumpla menos %", () => {
    // Audi crece a 4 coches; el usuario solo tiene 1 (naturalmente < plata),
    // pero persistió 'gold' → debe seguir viéndose oro.
    const grown = [
      { id: "c1", marca: "Audi", pais: "Alemania" },
      { id: "c2", marca: "Audi", pais: "Alemania" },
      { id: "c5", marca: "Audi", pais: "Alemania" },
      { id: "c6", marca: "Audi", pais: "Alemania" },
    ];
    const items = computeAchievements({
      cars: grown,
      wonCarIds: ["c1"],
      stats: {},
      persistedUnlocks: { brand_audi: "gold" },
    });
    expect(byId(items, "brand_audi").currentTier).toBe("gold");
  });
});

describe("buildPersistDiff", () => {
  it("emite el tier de colección si supera al persistido", () => {
    const items = computeAchievements({ cars, wonCarIds: ["c1", "c2"], stats: {} }); // Audi oro
    const diff = buildPersistDiff(items, { brand_audi: "silver" });
    expect(diff.brand_audi).toBe("gold");
  });

  it("no re-emite si ya está al mismo tier (no-op)", () => {
    const items = computeAchievements({ cars, wonCarIds: ["c1", "c2"], stats: {} });
    const diff = buildPersistDiff(items, { brand_audi: "gold" });
    expect(diff.brand_audi).toBeUndefined();
  });

  it("emite un hito booleano nuevo", () => {
    const items = computeAchievements({ cars, wonCarIds: ["c1"], stats: {} });
    const diff = buildPersistDiff(items, {});
    expect(diff.milestone_first).toBe(true);
  });

  it("no emite nada si no hay novedades", () => {
    const items = computeAchievements({ cars, wonCarIds: [], stats: {} });
    const diff = buildPersistDiff(items, {});
    expect(Object.keys(diff)).toHaveLength(0);
  });
});

describe("countDisplayedAchievements (hitos + rachas, total 8)", () => {
  it("siempre reporta 8 como total (5 hitos + 3 rachas)", () => {
    expect(countDisplayedAchievements({ wonCount: 0, maxStreak: 0 }).total).toBe(8);
  });

  it("jugador típico (14 coches, racha máx 3): 2 de 8", () => {
    // Hitos: 1 (Primer coche) y 10 (Garaje). Rachas: ninguna (< 7).
    expect(countDisplayedAchievements({ wonCount: 14, maxStreak: 3 })).toEqual({
      unlocked: 2,
      total: 8,
    });
  });

  it("cuenta hitos y rachas por separado", () => {
    // 25 coches → hitos 1,10,25 (3). Racha 7 → 1. Total 4.
    expect(countDisplayedAchievements({ wonCount: 25, maxStreak: 7 }).unlocked).toBe(4);
  });

  it("todo desbloqueado: 8 de 8", () => {
    expect(countDisplayedAchievements({ wonCount: 100, maxStreak: 100 }).unlocked).toBe(8);
  });

  it("defensivo: sin argumentos no rompe", () => {
    expect(countDisplayedAchievements()).toEqual({ unlocked: 0, total: 8 });
  });
});
