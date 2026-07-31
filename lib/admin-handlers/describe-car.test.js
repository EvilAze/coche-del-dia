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

  // El fallo que reportó el admin: el texto se veía "cortado a media frase".
  // Si el modelo se pasa de largo preferimos perder la última frase entera a
  // dejar una a medias, que es lo que delata que aquí ha cortado una máquina.
  it("recorta por el final de la última frase completa que quepa", () => {
    const frase = "El Delta ganó seis Mundiales seguidos entre 1987 y 1992. ";
    const largo = `${frase.repeat(11)}Y aquí una frase que ya no cabe entera y se`;
    const salida = limpiarDescripcion(largo);

    expect(salida.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LEN);
    expect(salida.endsWith("1992.")).toBe(true);
    expect(salida).not.toContain("que ya no cabe");
  });

  it("respeta el cierre de interrogaciones y exclamaciones", () => {
    const largo = `${"Nadie lo vio venir. ".repeat(28)}¿Por qué? ${"x".repeat(400)}`;
    const salida = limpiarDescripcion(largo);
    expect(salida.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LEN);
    // La última frase completa que cabe es la interrogativa: cerrar ahí es lo
    // correcto, no hay que buscar un punto más atrás.
    expect(salida.endsWith("¿Por qué?")).toBe(true);
  });

  it("nunca supera el tope aunque el modelo se pase muchísimo", () => {
    const largo = "Una frase corta y correcta. ".repeat(200);
    expect(limpiarDescripcion(largo).length).toBeLessThanOrEqual(MAX_DESCRIPTION_LEN);
  });
});
