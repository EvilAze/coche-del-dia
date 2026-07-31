import { describe, it, expect } from "vitest";
import { limpiarDescripcion, MAX_DESCRIPTION_LEN } from "./describe-car.js";

describe("limpiarDescripcion", () => {
  it("devuelve cadena vacía si no le llega texto", () => {
    expect(limpiarDescripcion(null)).toBe("");
    expect(limpiarDescripcion(undefined)).toBe("");
    expect(limpiarDescripcion(42)).toBe("");
    expect(limpiarDescripcion("   ")).toBe("");
  });

  it("colapsa saltos de línea y espacios repetidos", () => {
    expect(limpiarDescripcion("  El Delta\n\n  ganó  seis   Mundiales. ")).toBe(
      "El Delta ganó seis Mundiales."
    );
  });

  it("deja intacto un texto que ya cabe", () => {
    const texto = "Un compacto que ganó seis Mundiales seguidos.";
    expect(limpiarDescripcion(texto)).toBe(texto);
  });

  it("recorta a 600 sin partir una palabra por la mitad", () => {
    // 700 caracteres en palabras de 4 ("aaa ") → el corte cae dentro de una palabra
    const largo = "aaa ".repeat(175);
    const salida = limpiarDescripcion(largo);
    expect(salida.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LEN);
    expect(salida.endsWith("aaa")).toBe(true);
  });

  it("no deja puntuación ni espacios colgando tras el recorte", () => {
    const largo = `${"palabra ".repeat(80)}, y algo más`;
    const salida = limpiarDescripcion(largo);
    expect(salida).not.toMatch(/[\s,;:]$/);
  });
});
