// src/lib/distribucion.test.js
import { describe, it, expect } from "vitest";
import { contarDistribucion } from "./distribucion";

describe("contarDistribucion", () => {
  it("cuenta cada victoria en su intento y las derrotas aparte", () => {
    const filas = [
      { status: "won", i2: null, i3: null, i4: null, i5: null },
      { status: "won", i2: "wrong", i3: "correct", i4: null, i5: null },
      { status: "won", i2: "wrong", i3: "wrong", i4: "wrong", i5: "correct" },
      { status: "lost", i2: "wrong", i3: "wrong", i4: "wrong", i5: "wrong" },
    ];
    expect(contarDistribucion(filas)).toEqual({
      porIntento: [1, 0, 1, 0, 1],
      perdidas: 1,
      ganadas: 3,
      jugadas: 4,
    });
  });
  it("ignora las partidas a medias y las filas raras", () => {
    expect(contarDistribucion([{ status: "playing" }, null, {}])).toEqual({
      porIntento: [0, 0, 0, 0, 0],
      perdidas: 0,
      ganadas: 0,
      jugadas: 0,
    });
  });
  it("sin filas, todo a cero", () => {
    expect(contarDistribucion(undefined).jugadas).toBe(0);
  });
});
