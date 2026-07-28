// src/lib/resultCode.sync.test.js
// El códec del resultado vive por duplicado —src/lib/resultCode.js para el
// cliente, api/_lib/result-code.js para las funciones— porque no hay paquete
// compartido entre el bundle de Vite y el runtime de Vercel. Mismo caso que
// zoom.js, y mismo remedio: un test que compara las dos implementaciones.
//
// Lo que protege NO es teórico. El cliente CODIFICA el enlace que el jugador
// pega en el canal; el servidor DECODIFICA ese enlace para dibujar la tarjeta.
// Si una copia cambia y la otra no, el jugador comparte una partida y sus
// amigos ven otra distinta — y nada más lo delataría, porque cada mitad
// funciona perfectamente por su cuenta.

import { describe, it, expect } from "vitest";
import * as cliente from "./resultCode";
import * as servidor from "../../api/_lib/result-code.js";

const C = { status: "correct" };
const W = { status: "wrong" };
const P = { status: "partial" };
const row = (marca, modelo, anio) => ({ marca, modelo, anio });

describe("resultCode: cliente y servidor no pueden divergir", () => {
  it("exponen la misma constante de intentos", () => {
    expect(cliente.MAX_INTENTOS).toBe(servidor.MAX_INTENTOS);
  });

  const partidas = [
    [],
    [row(C, C, C)],
    [row(W, W, W), row(C, C, C)],
    [row(P, W, W), row(C, W, C), row(C, C, C)],
    [row(W, W, W), row(W, W, W), row(W, W, W), row(W, W, W), row(W, W, W)],
    // Más larga que el máximo: las dos copias tienen que recortar igual.
    [row(C, C, C), row(C, C, C), row(C, C, C), row(C, C, C), row(C, C, C), row(C, C, C)],
  ];

  it("codifican idéntico", () => {
    for (const p of partidas) {
      expect(cliente.encodeResult(p)).toBe(servidor.encodeResult(p));
    }
  });

  it("decodifican idéntico, incluida la basura de una URL tecleada a mano", () => {
    const codigos = ["", "0", "7", "047", "01234", "0123456789", "abc", "4x7", null, undefined];
    for (const c of codigos) {
      expect(cliente.decodeResult(c)).toEqual(servidor.decodeResult(c));
    }
  });
});

describe("resultCode: el formato", () => {
  it("tres bits por intento — marca 4, modelo 2, año 1", () => {
    expect(cliente.encodeResult([row(W, W, W)])).toBe("0");
    expect(cliente.encodeResult([row(W, W, C)])).toBe("1");
    expect(cliente.encodeResult([row(W, C, W)])).toBe("2");
    expect(cliente.encodeResult([row(C, W, W)])).toBe("4");
    expect(cliente.encodeResult([row(C, C, C)])).toBe("7");
  });

  it("el 'mismo país' cuenta como fallo, igual que hacía la rejilla de texto", () => {
    expect(cliente.encodeResult([row(P, W, W)])).toBe("0");
  });

  it("ida y vuelta: lo que codifica el cliente lo dibuja el servidor igual", () => {
    const partida = [row(W, W, C), row(C, W, C), row(C, C, C)];
    const decodificado = servidor.decodeResult(cliente.encodeResult(partida));
    expect(decodificado).toEqual([
      { marca: false, modelo: false, anio: true },
      { marca: true, modelo: false, anio: true },
      { marca: true, modelo: true, anio: true },
    ]);
  });

  it("no lanza con entradas corruptas", () => {
    expect(() => cliente.encodeResult(null)).not.toThrow();
    expect(() => cliente.encodeResult([null, {}])).not.toThrow();
    expect(cliente.decodeResult("no-es-un-codigo")).toEqual([]);
  });
});
