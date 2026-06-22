// src/lib/shareText.test.js
// Tests del generador PURO del texto compartido. Es un contrato visible (lo
// que el jugador pega en WhatsApp/Telegram) y el espejo de la rejilla que
// pinta EndScreen — antes vivía en useGame.js sin tests.

import { describe, it, expect } from "vitest";
import { buildShareText, shareGrid, getShareDate } from "./shareText";

// Helpers para fabricar guesses con la forma del contrato (result de compareGuess).
const C = { status: "correct" };
const W = { status: "wrong" };
const P = { status: "partial" };
const row = (marca, modelo, anio) => ({ marca, modelo, anio });

const WIN_DATE = "2026-05-24"; // inyectada → tests deterministas (no usa "hoy")

describe("shareGrid", () => {
  it("una línea ✅/❌ por intento, tres aciertos → ✅✅✅", () => {
    expect(shareGrid([row(C, C, C)])).toBe("✅✅✅");
  });

  it("binario: partial (mismo país) cuenta como ❌", () => {
    expect(shareGrid([row(P, W, W)])).toBe("❌❌❌");
  });

  it("varias filas se unen con salto de línea", () => {
    expect(shareGrid([row(C, W, C), row(C, C, C)])).toBe("✅❌✅\n✅✅✅");
  });

  it("no lanza con lista vacía ni filas malformadas", () => {
    expect(shareGrid([])).toBe("");
    expect(() => shareGrid([{}, null])).not.toThrow();
    expect(shareGrid([{}])).toBe("❌❌❌");
  });
});

describe("getShareDate", () => {
  it("convierte YYYY-MM-DD en DD/MM (sin año)", () => {
    expect(getShareDate("2026-05-24")).toBe("24/05");
    expect(getShareDate("2026-01-05")).toBe("05/01");
  });
});

describe("buildShareText", () => {
  it("cabecera de victoria: N/max y rejilla, dominio como última línea", () => {
    const guesses = [row(C, W, C), row(C, C, C)];
    const text = buildShareText(guesses, 0, 5, WIN_DATE);
    expect(text).toBe(
      "Coche del Día · 24/05 · 2/5\n✅❌✅\n✅✅✅\ncochedeldia.com"
    );
  });

  it("derrota (última fila no perfecta) → X/max", () => {
    const guesses = [row(W, W, W)];
    const text = buildShareText(guesses, 0, 5, WIN_DATE);
    expect(text.split("\n")[0]).toBe("Coche del Día · 24/05 · X/5");
  });

  it("racha > 0 añade · 🔥N; racha 0 lo omite", () => {
    const win = [row(C, C, C)];
    expect(buildShareText(win, 7, 5, WIN_DATE).split("\n")[0]).toBe(
      "Coche del Día · 24/05 · 1/5 · 🔥7"
    );
    expect(buildShareText(win, 0, 5, WIN_DATE).split("\n")[0]).toBe(
      "Coche del Día · 24/05 · 1/5"
    );
  });

  it("respeta maxAttempts (no asume 5)", () => {
    const win = [row(C, C, C)];
    expect(buildShareText(win, 0, 6, WIN_DATE).split("\n")[0]).toContain("1/6");
  });

  it("no lanza con guesses vacío o no-array", () => {
    expect(() => buildShareText([], 0, 5, WIN_DATE)).not.toThrow();
    expect(() => buildShareText(undefined, 0, 5, WIN_DATE)).not.toThrow();
    expect(buildShareText([], 0, 5, WIN_DATE).split("\n")[0]).toBe(
      "Coche del Día · 24/05 · X/5"
    );
  });
});
