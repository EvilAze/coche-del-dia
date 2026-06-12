import { describe, it, expect } from "vitest";
import { fitFontSize } from "./fitText";

describe("fitFontSize", () => {
  it("deja el tamaño base cuando el texto ya cabe", () => {
    expect(fitFontSize({ scrollWidth: 80, clientWidth: 100, base: 12.5, min: 10 })).toBe(12.5);
  });

  it("no encoge por debajo del suelo (min) aunque el desborde sea grande", () => {
    // 100/300 → ideal muy por debajo de min → se acota a min.
    expect(fitFontSize({ scrollWidth: 300, clientWidth: 100, base: 12.5, min: 10 })).toBe(10);
  });

  it("interpola entre min y base para un desborde moderado", () => {
    // 12 * (110/120) * 0.97 = 10.67 → floor 0.1 → 10.6
    expect(fitFontSize({ scrollWidth: 120, clientWidth: 110, base: 12, min: 9 })).toBe(10.6);
  });

  it("devuelve el base si las medidas no son válidas (primer paint)", () => {
    expect(fitFontSize({ scrollWidth: 200, clientWidth: 0, base: 12.5, min: 10 })).toBe(12.5);
    expect(fitFontSize({ scrollWidth: 0, clientWidth: 100, base: 12.5, min: 10 })).toBe(12.5);
  });
});
