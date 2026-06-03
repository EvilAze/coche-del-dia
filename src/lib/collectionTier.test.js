import { describe, it, expect } from "vitest";
import { countryTier, brandTier } from "./collectionTier";

describe("countryTier (bronce 25% · plata 50% · oro 100%)", () => {
  it("null si no hay desbloqueos o total inválido", () => {
    expect(countryTier(0, 8)).toBe(null);
    expect(countryTier(3, 0)).toBe(null);
    expect(countryTier(-1, 8)).toBe(null);
  });

  it("oro al 100%", () => {
    expect(countryTier(8, 8)).toBe("gold");
  });

  it("plata al 50%, bronce al 25%", () => {
    expect(countryTier(4, 8)).toBe("silver");
    expect(countryTier(2, 8)).toBe("bronze");
  });

  it("null por debajo del 25%", () => {
    expect(countryTier(1, 8)).toBe(null);
  });

  it("umbrales redondean hacia arriba (total impar)", () => {
    // total 10: bronce=ceil(2.5)=3, plata=ceil(5)=5
    expect(countryTier(2, 10)).toBe(null);
    expect(countryTier(3, 10)).toBe("bronze");
    expect(countryTier(5, 10)).toBe("silver");
  });
});

describe("brandTier (sin bronce: plata 50% · oro 100%)", () => {
  it("null por debajo del 50% (el 25% no cuenta en marcas)", () => {
    expect(brandTier(0, 8)).toBe(null);
    expect(brandTier(2, 8)).toBe(null);
  });

  it("plata al 50%, oro al 100%", () => {
    expect(brandTier(4, 8)).toBe("silver");
    expect(brandTier(8, 8)).toBe("gold");
  });

  it("marca de 1 coche: 1/1 es oro directo", () => {
    expect(brandTier(1, 1)).toBe("gold");
  });
});
