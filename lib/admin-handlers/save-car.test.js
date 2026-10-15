// lib/admin-handlers/save-car.test.js
// El 15-oct-2026 el coche del día entró como «TVR» y el resto del catálogo
// estaba en «Tvr»: el cupón comparó con `===`, vio dos marcas y el modelo no
// se podía elegir. La propiedad: guardar una marca que ya existe con otra
// grafía usa la que ya existe, y un catálogo ya partido se rechaza.

import { describe, it, expect } from "vitest";
import { resolveMarcaCanonica, marcaKey } from "./save-car.js";

describe("resolveMarcaCanonica", () => {
  it("el caso TVR: «TVR» con el catálogo en «Tvr» se guarda como «Tvr»", () => {
    expect(resolveMarcaCanonica("TVR", ["Tvr", "Tvr", "Tvr"])).toEqual({ value: "Tvr" });
  });

  it("ignora espacios sobrantes al comparar", () => {
    expect(resolveMarcaCanonica("  aston   martin ", ["Aston Martin"])).toEqual({
      value: "Aston Martin",
    });
  });

  it("una marca nueva se guarda tal cual, solo limpia de espacios", () => {
    expect(resolveMarcaCanonica(" De  Tomaso ", ["Ferrari"])).toEqual({ value: "De Tomaso" });
    expect(resolveMarcaCanonica("TVR", [])).toEqual({ value: "TVR" });
  });

  it("si el catálogo ya tiene dos grafías, error claro en vez de elegir a ciegas", () => {
    const r = resolveMarcaCanonica("tvr", ["TVR", "Tvr"]);
    expect(r.value).toBeUndefined();
    expect(r.error).toMatch(/«TVR».*«Tvr»/);
  });

  it("marcaKey iguala lo que el cupón no debería distinguir", () => {
    expect(marcaKey(" TVR ")).toBe(marcaKey("tvr"));
    expect(marcaKey("Aston  Martin")).toBe(marcaKey("aston martin"));
  });
});
