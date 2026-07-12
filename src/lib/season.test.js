// src/lib/season.test.js
import { describe, it, expect } from "vitest";
import { daysUntilClose } from "./season";

// today fijo (Madrid) construido desde una fecha UTC dentro del día 2026-07-25.
const today = new Date("2026-07-25T09:00:00Z");

describe("daysUntilClose", () => {
  it("ends_at hoy → 0 (cierra hoy)", () => {
    expect(daysUntilClose("2026-07-25", today)).toBe(0);
  });
  it("ends_at mañana → 1", () => {
    expect(daysUntilClose("2026-07-26", today)).toBe(1);
  });
  it("ends_at dentro de 5 días → 5", () => {
    expect(daysUntilClose("2026-07-30", today)).toBe(5);
  });
  it("ends_at pasado → negativo", () => {
    expect(daysUntilClose("2026-07-24", today)).toBe(-1);
  });
  it("entrada inválida → null", () => {
    expect(daysUntilClose("", today)).toBe(null);
    expect(daysUntilClose(null, today)).toBe(null);
  });
});
