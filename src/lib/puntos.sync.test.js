// src/lib/puntos.sync.test.js
// La ayuda enseña la misma curva que puntúa el servidor (ver src/lib/puntos.js).
import { describe, it, expect } from "vitest";
import { PUNTOS_POR_INTENTO, BONUS_RACHA, bonusDeRacha, puntuacionDelDia } from "./puntos.js";
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
  it("bonusDeRacha da lo mismo que el servidor para cualquier racha", () => {
    for (const racha of [0, 1, 2, 3, 4, 5, 12, 30, NaN, null, undefined]) {
      expect(bonusDeRacha(racha)).toBe(streakBonusFor(racha, true));
    }
  });
});

describe("puntuacionDelDia: la puntuación que se reconstruye al volver", () => {
  it("suma la base del intento y el bonus de la racha de hoy", () => {
    expect(puntuacionDelDia(4, 1)).toEqual({ basePoints: 3, streakBonus: 0, totalPoints: 3 });
    expect(puntuacionDelDia(1, 2)).toEqual({ basePoints: 10, streakBonus: 1, totalPoints: 11 });
    expect(puntuacionDelDia(3, 9)).toEqual({ basePoints: 4, streakBonus: 3, totalPoints: 7 });
  });
  it("coincide con la base del servidor en los cinco intentos", () => {
    for (let n = 1; n <= 5; n++) {
      expect(puntuacionDelDia(n, 0).basePoints).toBe(basePointsFor(n, true));
    }
  });
  it("sin un número de intentos válido no se inventa nada", () => {
    expect(puntuacionDelDia(0, 3)).toBeNull();
    expect(puntuacionDelDia(6, 3)).toBeNull();
    expect(puntuacionDelDia(undefined, 3)).toBeNull();
  });
});
