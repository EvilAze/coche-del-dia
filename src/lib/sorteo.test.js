// src/lib/sorteo.test.js
import { describe, it, expect } from "vitest";
import {
  ticsCarrete,
  patronTrinquete,
  curvaGiroCss,
  GIRO_MS,
  SEPARACION_MIN_TIC_MS,
} from "./sorteo";

describe("ticsCarrete", () => {
  const tics = ticsCarrete();

  it("hay tics, en orden y dentro del giro", () => {
    expect(tics.length).toBeGreaterThan(4);
    for (let i = 1; i < tics.length; i++) expect(tics[i]).toBeGreaterThan(tics[i - 1]);
    expect(tics[tics.length - 1]).toBeLessThanOrEqual(GIRO_MS);
  });

  it("nunca dos tics más juntos que la separación mínima", () => {
    for (let i = 1; i < tics.length; i++) {
      expect(tics[i] - tics[i - 1]).toBeGreaterThanOrEqual(SEPARACION_MIN_TIC_MS);
    }
  });

  it("se van espaciando: el carrete frena", () => {
    const primera = tics[1] - tics[0];
    const ultima = tics[tics.length - 1] - tics[tics.length - 2];
    expect(ultima).toBeGreaterThan(primera);
  });

  it("con una curva lineal, un tic por número y a intervalos iguales", () => {
    const lineal = ticsCarrete({ fichas: 5, duracion: 400, curva: [0, 0, 1, 1], separacion: 0 });
    expect(lineal).toEqual([100, 200, 300, 400]);
  });
});

describe("patronTrinquete", () => {
  it("alterna tic y pausa, sin pausa delante", () => {
    expect(patronTrinquete([0, 100, 250], 6)).toEqual([6, 94, 6, 144, 6]);
  });
  it("sin tics, patrón vacío", () => {
    expect(patronTrinquete([])).toEqual([]);
  });
});

describe("curvaGiroCss", () => {
  it("es una cubic-bezier válida para el CSS", () => {
    expect(curvaGiroCss()).toMatch(/^cubic-bezier\([\d.]+,[\d.]+,[\d.]+,[\d.]+\)$/);
  });
});
