// api/_lib/compare-guess.test.js
// Tests de la comparación pura intento-vs-coche-del-día. Cubren el contrato
// del objeto `result` que consume el frontend y las reglas de juego menos
// obvias: margen de año ±2, "partial" por país y normalización de strings.

import { describe, it, expect } from "vitest";
import { compareGuess, ANIO_CORRECT_MARGIN } from "./compare-guess.js";

const REAL = {
  marca: "Nissan",
  modelo: "Silvia S15",
  anio: 1999,
  pais: "JP",
};

function guess({ make = "Nissan", model = "Silvia S15", pais = "JP", anio = 1999 } = {}) {
  return { realCar: REAL, guessRow: { make, model, pais }, guessAnio: anio };
}

describe("compareGuess", () => {
  it("acierto total → win y las tres celdas correct", () => {
    const r = compareGuess(guess());
    expect(r.win).toBe(true);
    expect(r.marca.status).toBe("correct");
    expect(r.modelo.status).toBe("correct");
    expect(r.anio.status).toBe("correct");
    expect(r.anio.direction).toBeNull();
  });

  it("la comparación de marca/modelo ignora mayúsculas y espacios", () => {
    const r = compareGuess(guess({ make: "  nissan ", model: "SILVIA s15" }));
    expect(r.win).toBe(true);
  });

  it(`el año cuenta como correcto dentro de ±${ANIO_CORRECT_MARGIN}`, () => {
    expect(compareGuess(guess({ anio: 1999 - ANIO_CORRECT_MARGIN })).anio.status).toBe("correct");
    expect(compareGuess(guess({ anio: 1999 + ANIO_CORRECT_MARGIN })).anio.status).toBe("correct");
  });

  it("año fuera de margen → wrong con direction hacia el real", () => {
    const low = compareGuess(guess({ anio: 1990 }));
    expect(low.anio.status).toBe("wrong");
    expect(low.anio.direction).toBe("up");
    expect(low.win).toBe(false);

    const high = compareGuess(guess({ anio: 2010 }));
    expect(high.anio.direction).toBe("down");
  });

  it("año no numérico → wrong, nunca lanza", () => {
    const r = compareGuess(guess({ anio: "no-es-un-año" }));
    expect(r.anio.status).toBe("wrong");
    expect(r.win).toBe(false);
  });

  it("marca incorrecta con mismo país → partial", () => {
    const r = compareGuess(guess({ make: "Toyota", model: "Supra", pais: "JP" }));
    expect(r.marca.status).toBe("partial");
    expect(r.win).toBe(false);
  });

  it("marca incorrecta con país distinto → wrong", () => {
    const r = compareGuess(guess({ make: "BMW", model: "M3", pais: "DE" }));
    expect(r.marca.status).toBe("wrong");
  });

  it("marca correcta no se degrada a partial aunque el país coincida", () => {
    const r = compareGuess(guess({ model: "GT-R" }));
    expect(r.marca.status).toBe("correct");
    expect(r.modelo.status).toBe("wrong");
    expect(r.win).toBe(false);
  });

  it("el shape del result es el contrato persistido (val/status por celda)", () => {
    const r = compareGuess(guess({ anio: 1998 }));
    expect(Object.keys(r).sort()).toEqual(["anio", "marca", "modelo", "win"]);
    expect(r.marca).toHaveProperty("val");
    expect(r.marca).toHaveProperty("pais");
    expect(r.anio.val).toBe("1998"); // siempre string, como teclea el usuario
  });
});
