// src/data/catalog.test.js
// El catálogo es el único dato sin el cual el cupón no se puede rellenar: sin
// marcas no hay lista que abrir, así que GuessForm deshabilita los tres
// renglones. Eso convierte un bache de red de dos segundos en una partida que
// parece rota — reportado el 2026-08-10 en una repesca.
//
// Lo que se prueba aquí es justo lo que evita ese caso: que un fallo aislado no
// se propague a la interfaz, y que uno persistente sí lo haga (con error, para
// que arriba se pueda pintar el cartel y el botón de reintentar).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

async function cargarModulo() {
  vi.resetModules(); // tira la promesa compartida entre tests
  return import("./catalog");
}

const OK = { cars: [{ id: 1, marca: "Seat", modelo: "Ibiza" }], marcas: ["Seat"] };
const respuestaOk = () => ({ ok: true, status: 200, json: async () => OK });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadCatalog", () => {
  it("un fallo suelto no llega al usuario: reintenta y devuelve el catálogo", async () => {
    global.fetch
      .mockRejectedValueOnce(new Error("red caída"))
      .mockResolvedValueOnce(respuestaOk());

    const { loadCatalog } = await cargarModulo();
    await expect(loadCatalog()).resolves.toEqual(OK);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("un 500 cuenta como fallo (no devuelve la respuesta a medias)", async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce(respuestaOk());

    const { loadCatalog } = await cargarModulo();
    await expect(loadCatalog()).resolves.toEqual(OK);
  });

  it("si no hay manera, rechaza tras agotar los reintentos", async () => {
    global.fetch.mockRejectedValue(new Error("red caída"));

    const { loadCatalog } = await cargarModulo();
    await expect(loadCatalog()).rejects.toThrow("red caída");
    // Uno inicial + REINTENTOS. Es el número que separa "insiste un poco" de
    // "insiste para siempre y nadie se entera de que algo va mal".
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("tras fallar del todo, la siguiente llamada vuelve a intentarlo", async () => {
    global.fetch.mockRejectedValue(new Error("red caída"));
    const { loadCatalog } = await cargarModulo();
    await expect(loadCatalog()).rejects.toThrow();

    // La promesa fallida NO se queda cacheada: si se quedara, el botón de
    // reintentar de GuessForm devolvería el mismo error sin tocar la red y el
    // cupón no se recuperaría nunca.
    global.fetch.mockReset();
    global.fetch.mockResolvedValue(respuestaOk());
    await expect(loadCatalog()).resolves.toEqual(OK);
  });

  it("las llamadas simultáneas comparten una sola petición", async () => {
    global.fetch.mockResolvedValue(respuestaOk());
    const { loadCatalog } = await cargarModulo();

    const [a, b] = await Promise.all([loadCatalog(), loadCatalog()]);
    expect(a).toBe(b);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
