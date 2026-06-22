// api/_lib/score.test.js
// Tests de la puntuación base por intento. Es regla de juego pura (afecta al
// ranking) y antes vivía inline en validate-guess.js sin un solo test.

import { describe, it, expect } from "vitest";
import { basePointsFor, BASE_POINTS_BY_ATTEMPT } from "./score.js";

describe("basePointsFor", () => {
  it("curva descendente para victoria: 1→10, 2→6, 3→4, 4→3, 5→2", () => {
    expect(basePointsFor(1, true)).toBe(10);
    expect(basePointsFor(2, true)).toBe(6);
    expect(basePointsFor(3, true)).toBe(4);
    expect(basePointsFor(4, true)).toBe(3);
    expect(basePointsFor(5, true)).toBe(2);
  });

  it("derrota → 0 puntos sea cual sea el intento", () => {
    expect(basePointsFor(1, false)).toBe(0);
    expect(basePointsFor(5, false)).toBe(0);
  });

  it("intento fuera de la tabla → 0 (defensa, nunca undefined/NaN)", () => {
    expect(basePointsFor(0, true)).toBe(0);
    expect(basePointsFor(7, true)).toBe(0);
    expect(basePointsFor(undefined, true)).toBe(0);
  });

  it("la tabla replica el CASE de los .sql (incluye el 6 vestigial)", () => {
    // Réplica de scripts/supabase-streak-freeze.sql y supabase-monthly-ranking.sql.
    expect(BASE_POINTS_BY_ATTEMPT).toEqual({ 1: 10, 2: 6, 3: 4, 4: 3, 5: 2, 6: 1 });
  });
});
