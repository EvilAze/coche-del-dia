// src/lib/season.test.js
import { describe, it, expect } from "vitest";
import { daysUntilClose, creditoTemporada, progresoPeriodo } from "./season";

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

// Traductor de mentira: devuelve la clave y las variables, para poder afirmar
// QUÉ se pide traducir sin depender de los locales reales.
const t = (k, vars) => (vars ? `${k}:${JSON.stringify(vars)}` : k);

describe("creditoTemporada", () => {
  const temporada = {
    number: 4,
    label_es: "Bombas de bolsillo",
    label_en: "Pocket Rockets",
    presenta_es: null,
    presenta_en: null,
  };

  it("sin temporada activa no hay crédito (el hueco entre ciclos)", () => {
    expect(creditoTemporada(null, "es", t)).toBe(null);
    expect(creditoTemporada(undefined, "es", t)).toBe(null);
  });

  it("temporada normal → se anuncia el tema, en el idioma que toca", () => {
    expect(creditoTemporada(temporada, "es", t)).toBe(
      'prensa.temporada:{"tema":"Bombas de bolsillo"}'
    );
    expect(creditoTemporada(temporada, "en", t)).toBe(
      'prensa.temporada:{"tema":"Pocket Rockets"}'
    );
  });

  it("con colaboración manda el crédito, NO el tema", () => {
    const conPresenta = {
      ...temporada,
      presenta_es: "USPI · POWERART",
      presenta_en: "USPI · POWERART",
    };
    expect(creditoTemporada(conPresenta, "es", t)).toBe("USPI · POWERART");
  });

  it("presenta vacío es lo mismo que no tenerlo (no un crédito en blanco)", () => {
    // El panel guarda cadena vacía cuando el admin borra el campo; si eso
    // colara, el filete acabaría en un hueco mudo.
    const vacio = { ...temporada, presenta_es: "", presenta_en: "" };
    expect(creditoTemporada(vacio, "es", t)).toBe(
      'prensa.temporada:{"tema":"Bombas de bolsillo"}'
    );
  });

  it("temporada sin etiqueta usable → sin crédito, no una línea rota", () => {
    const sinLabel = { ...temporada, label_es: "", label_en: "" };
    expect(creditoTemporada(sinLabel, "es", t)).toBe(null);
  });
});

describe("progresoPeriodo", () => {
  it("cuenta los dos extremos: del 12 al 25 son 14 días y hoy es el 14", () => {
    expect(progresoPeriodo("2026-07-12", "2026-07-25", today)).toEqual({ dia: 14, total: 14 });
  });
  it("el primer día es el 1", () => {
    expect(progresoPeriodo("2026-07-25", "2026-08-07", today)).toEqual({ dia: 1, total: 14 });
  });
  it("a mitad de periodo", () => {
    expect(progresoPeriodo("2026-07-20", "2026-07-26", today)).toEqual({ dia: 6, total: 7 });
  });
  it("un reloj desfasado no se sale del periodo", () => {
    expect(progresoPeriodo("2026-07-26", "2026-08-01", today)).toEqual({ dia: 1, total: 7 });
    expect(progresoPeriodo("2026-07-10", "2026-07-20", today)).toEqual({ dia: 11, total: 11 });
  });
  it("fechas inválidas o al revés → null", () => {
    expect(progresoPeriodo(null, "2026-07-25", today)).toBe(null);
    expect(progresoPeriodo("2026-07-25", "nope", today)).toBe(null);
    expect(progresoPeriodo("2026-07-26", "2026-07-25", today)).toBe(null);
  });
});
