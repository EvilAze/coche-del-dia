// src/lib/puntos.sync.test.js
// La ayuda enseña la misma curva que puntúa el servidor (ver src/lib/puntos.js).
import { describe, it, expect } from "vitest";
import { PUNTOS_POR_INTENTO, BONUS_RACHA } from "./puntos.js";
import { basePointsFor, streakBonusFor } from "../../api/_lib/score.js";

describe("sincronía src/lib/puntos.js ↔ api/_lib/score.js", () => {
  it("los puntos de cada intento son los del servidor", () => {
    PUNTOS_POR_INTENTO.forEach((pts, i) => {
      expect(pts).toBe(basePointsFor(i + 1, true));
    });
  });
  it("el bonus de cada escalón de racha es el del servidor", () => {
    BONUS_RACHA.forEach(({ dias, bonus }) => {
      expect(bonus).toBe(streakBonusFor(dias, true));
    });
    // Y a partir del último escalón ya no sube.
    expect(streakBonusFor(30, true)).toBe(BONUS_RACHA[BONUS_RACHA.length - 1].bonus);
  });
});
