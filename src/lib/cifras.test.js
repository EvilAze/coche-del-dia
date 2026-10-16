// src/lib/cifras.test.js
// La ficha técnica pinta solo lo que existe, en el orden de una ficha, y con la
// coma de quien la lee. Y las claves son las mismas que manda el servidor: si
// una se renombra en un lado, la cifra desaparece del panel sin ningún error.

import { describe, it, expect } from "vitest";
import { ORDEN_CIFRAS, cifrasVisibles, formatearCifra } from "./cifras.js";
import { CIFRAS as CIFRAS_SERVIDOR } from "../../api/_lib/cifras.js";

describe("cifrasVisibles", () => {
  it("las cuatro, en el orden de una ficha aunque lleguen desordenadas", () => {
    const r = cifrasVisibles({ vmaxKmh: 305, aceleracion: 3.9, parNm: 600, potenciaCv: 510 });
    expect(r.map((c) => [c.clave, c.valor])).toEqual([
      ["potenciaCv", 510],
      ["parNm", 600],
      ["aceleracion", 3.9],
      ["vmaxKmh", 305],
    ]);
  });

  it("solo las que existen: sin huecos para las que faltan", () => {
    const r = cifrasVisibles({ potenciaCv: 75, vmaxKmh: 150 });
    expect(r.map((c) => c.clave)).toEqual(["potenciaCv", "vmaxKmh"]);
  });

  it("lo que no es un número positivo no se pinta", () => {
    expect(cifrasVisibles({ potenciaCv: 0, parNm: null, aceleracion: NaN, vmaxKmh: "305" })).toEqual([]);
    expect(cifrasVisibles({ potenciaCv: -5 })).toEqual([]);
  });

  it("sin cifras (perdiendo, o un coche sin rellenar), lista vacía", () => {
    for (const v of [null, undefined, {}, "x", 42]) expect(cifrasVisibles(v)).toEqual([]);
  });

  it("cada cifra trae su etiqueta y su unidad para el i18n", () => {
    const [c] = cifrasVisibles({ aceleracion: 3.9 });
    expect(c).toMatchObject({ etiqueta: "fin.cifras.aceleracion", unidad: "fin.cifras.s", decimales: 1 });
  });
});

describe("formatearCifra", () => {
  it("con la coma de quien la lee", () => {
    expect(formatearCifra(3.9, 1, "es")).toBe("3,9");
    expect(formatearCifra(3.9, 1, "en")).toBe("3.9");
  });

  it("el 0-100 siempre con su decimal, también si es redondo", () => {
    expect(formatearCifra(4, 1, "es")).toBe("4,0");
  });

  it("los enteros, sin decimales", () => {
    expect(formatearCifra(510, 0, "es")).toBe("510");
    expect(formatearCifra(305, 0, "en")).toBe("305");
  });

  it("un locale imposible no deja la ficha sin cifra", () => {
    expect(formatearCifra(3.9, 1, "no es un locale!")).toBe("3.9");
    expect(formatearCifra(510, 0, "no es un locale!")).toBe("510");
  });
});

describe("réplica de las claves del servidor", () => {
  it("el cliente pinta exactamente las cifras que manda api/_lib/cifras.js", () => {
    expect(ORDEN_CIFRAS.map((c) => c.clave)).toEqual(CIFRAS_SERVIDOR.map((c) => c.clave));
  });

  it("y con los mismos decimales", () => {
    expect(ORDEN_CIFRAS.map((c) => c.decimales)).toEqual(CIFRAS_SERVIDOR.map((c) => c.decimales));
  });
});
