import { describe, it, expect } from "vitest";
import { resolver } from "./resolver";

const MARCAS = ["Jaguar", "Lancia", "Lamborghini", "Seat"];

describe("resolver (prefijo inequívoco → valor canónico)", () => {
  it("prefijo único autocompleta al canónico", () => {
    expect(resolver("jag", MARCAS)).toBe("Jaguar");
  });

  it("coincidencia exacta gana aunque haya otros prefijos", () => {
    expect(resolver("lancia", MARCAS)).toBe("Lancia");
  });

  it("prefijo ambiguo NO adivina", () => {
    // "la" casa con Lancia y Lamborghini: se devuelve lo escrito.
    expect(resolver("la", MARCAS)).toBe("la");
  });

  it("sin match devuelve lo escrito, recortado", () => {
    expect(resolver("  bmw ", MARCAS)).toBe("bmw");
  });

  it("ignora tildes y mayúsculas en la comparación", () => {
    expect(resolver("citroen", ["Citroën"])).toBe("Citroën");
  });

  it("vacío se devuelve tal cual", () => {
    expect(resolver("   ", MARCAS)).toBe("");
  });
});
