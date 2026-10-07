import { describe, it, expect } from "vitest";
import { pistasAprendidas } from "./pistas";
import es from "../i18n/locales/es.json";

// `t` mínimo sobre el locale real: si una clave desaparece del JSON, el test lo
// ve en vez de comparar contra cadenas inventadas.
function t(clave, vars = {}) {
  const valor = clave.split(".").reduce((o, k) => o?.[k], es);
  if (typeof valor !== "string") throw new Error(`clave inexistente: ${clave}`);
  return valor.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
}

const intento = (marca, modelo, anio) => ({ marca, modelo, anio });
const mal = (val) => ({ val, status: "wrong" });

describe("pistasAprendidas", () => {
  it("sin intentos no hay nada que contar", () => {
    expect(pistasAprendidas([], 2, t, 2026)).toEqual([]);
  });

  it("todo fallado deja al menos la horquilla del año, a media frase", () => {
    const g = [intento(mal("Ferrari"), mal("F40"), { val: 1998, status: "wrong", direction: "up" })];
    expect(pistasAprendidas(g, 2, t, 2026)).toEqual(["año 2001 o posterior"]);
  });

  it("con las dos flechas, la horquilla sale cerrada y en minúscula", () => {
    const g = [
      intento(mal("Ferrari"), mal("F40"), { val: 1990, status: "wrong", direction: "up" }),
      intento(mal("Seat"), mal("Ibiza"), { val: 2010, status: "wrong", direction: "down" }),
    ];
    expect(pistasAprendidas(g, 2, t, 2026)).toEqual(["año entre 1993 y 2007"]);
  });

  it("«mismo país» se dice con la marca que lo destapó", () => {
    const g = [intento({ val: "Alfa Romeo", status: "partial", pais: "IT" }, mal("Giulia"), { val: 2010, status: "wrong", direction: "down" })];
    expect(pistasAprendidas(g, 2, t, 2026)).toEqual([
      "es del mismo país que Alfa Romeo",
      "año 2007 o anterior",
    ]);
  });

  it("con el nombre del país a mano, dice el país además de la marca", () => {
    const g = [intento({ val: "Nissan", status: "partial", pais: "JP" }, mal("300ZX"), { val: 1990, status: "correct" })];
    const nombrePais = (codigo) => ({ JP: "Japón" })[codigo];
    expect(pistasAprendidas(g, 2, t, 2026, nombrePais)).toEqual([
      "es de Japón, como Nissan",
      "el año es 1990, ±2",
    ]);
  });

  it("la marca acertada manda sobre el país, y el año acertado sobre la horquilla", () => {
    const g = [
      intento({ val: "Alfa Romeo", status: "partial" }, mal("Giulia"), { val: 2010, status: "wrong", direction: "down" }),
      intento({ val: "Lamborghini", status: "correct" }, mal("Diablo"), { val: 2004, status: "correct" }),
    ];
    expect(pistasAprendidas(g, 2, t, 2026)).toEqual([
      "la marca es Lamborghini",
      "el año es 2004, ±2",
    ]);
  });

  it("el modelo acertado también se cuenta", () => {
    const g = [intento({ val: "Seat", status: "correct" }, { val: "Ibiza", status: "correct" }, { val: 1990, status: "wrong", direction: "up" })];
    expect(pistasAprendidas(g, 2, t, 2026)).toEqual([
      "la marca es Seat",
      "el modelo es Ibiza",
      "año 1993 o posterior",
    ]);
  });
});
