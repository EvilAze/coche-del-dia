import { describe, it, expect } from "vitest";
import { deducirPais } from "./deduccion";

const PAIS = { "Alfa Romeo": "IT", Lancia: "IT", Fiat: "IT", Seat: "ES", BMW: "DE", Audi: "DE", Raro: undefined };

describe("deducirPais", () => {
  it("sin intentos no deduce nada", () => {
    const d = deducirPais([], PAIS);
    expect(d.paisSabido).toBeNull();
    expect(d.pista("Lancia")).toBeNull();
  });

  it("una marca fallada descarta TODO su país, no solo esa marca", () => {
    const d = deducirPais([{ marca: { val: "BMW", status: "wrong" } }], PAIS);
    expect(d.pista("Audi")).toBe("descartada");
    expect(d.pista("Seat")).toBeNull();
  });

  it("«mismo país» fija el país y descarta el resto", () => {
    const d = deducirPais([{ marca: { val: "Alfa Romeo", status: "partial", pais: "IT" } }], PAIS);
    expect(d.paisSabido).toBe("IT");
    expect(d.pista("Lancia")).toBe("pais");
    expect(d.pista("Seat")).toBe("descartada");
  });

  it("usa el país del catálogo si el servidor no lo manda", () => {
    const d = deducirPais([{ marca: { val: "Fiat", status: "partial" } }], PAIS);
    expect(d.pista("Lancia")).toBe("pais");
  });

  it("una marca sin país en el catálogo no se marca nunca", () => {
    const d = deducirPais([{ marca: { val: "Fiat", status: "partial" } }], PAIS);
    expect(d.pista("Raro")).toBeNull();
  });

  it("tolera intentos mal formados", () => {
    const d = deducirPais([null, {}, { marca: null }], PAIS);
    expect(d.paisSabido).toBeNull();
  });
});
