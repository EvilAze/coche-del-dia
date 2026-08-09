// src/lib/texto.test.js
// El buscador de marcas y modelos depende entero de esta función: si deja de
// quitar tildes, "Citroen" no encuentra "Citroën" y el jugador cree que su
// coche no está en el catálogo.
//
// Y hay un motivo extra para atarlo con un test: el rango de tildes va escrito
// como escape unicode a propósito (regla 14). Si alguien lo "arregla" poniendo
// los caracteres literales y el fichero se re-guarda mal, esto lo caza aquí en
// vez de en producción con el chunk sin parsear.

import { describe, it, expect } from "vitest";
import { normalizar } from "./texto";

describe("normalizar", () => {
  it("pasa a minúsculas", () => {
    expect(normalizar("Volkswagen")).toBe("volkswagen");
  });

  it("quita las tildes y la diéresis", () => {
    expect(normalizar("Citroën")).toBe("citroen");
    expect(normalizar("Škoda")).toBe("skoda");
    expect(normalizar("Mercedes-Benz")).toBe("mercedes-benz");
  });

  it("hace que buscar sin tilde encuentre lo que la lleva", () => {
    expect(normalizar("Citroën").includes(normalizar("citroen"))).toBe(true);
    expect(normalizar("Škoda").includes(normalizar("sko"))).toBe(true);
  });

  it("aguanta null, undefined y vacío", () => {
    expect(normalizar(null)).toBe("");
    expect(normalizar(undefined)).toBe("");
    expect(normalizar("")).toBe("");
  });
});
