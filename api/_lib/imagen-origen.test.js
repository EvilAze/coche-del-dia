// api/_lib/imagen-origen.test.js
// La derivación de la URL del master es la pieza frágil de todo esto: es
// manipulación de rutas, y si se equivoca en silencio el resultado no es un
// error sino volver a descargar el original SIEMPRE — o sea, el problema de
// egress intacto y nadie enterándose. Por eso va con tests.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { urlDelMaster, leerImagenOrigen, _resetCacheImagenes } from "./imagen-origen.js";

const PUB = "https://ref.supabase.co/storage/v1/object/public/cars_images";
const ORIG = `${PUB}/1712345678-audi-tt.jpg`;
const MASTER = `${PUB}/master/1712345678-audi-tt.jpg.webp`;

function resp(ok, body = "bytes", contentType = "image/jpeg") {
  return {
    ok,
    status: ok ? 200 : 404,
    headers: { get: () => contentType },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

beforeEach(() => {
  _resetCacheImagenes();
  vi.restoreAllMocks();
});

describe("urlDelMaster", () => {
  it("mete el fichero en master/ y le pone .webp", () => {
    expect(urlDelMaster(ORIG)).toBe(MASTER);
  });

  it("respeta subcarpetas dentro del bucket", () => {
    expect(urlDelMaster(`${PUB}/2026/08/foto.png`)).toBe(`${PUB}/master/2026/08/foto.png.webp`);
  });

  it("no genera el master DE UN MASTER", () => {
    // Sin esto acabaríamos con master/master/... a la primera regeneración.
    expect(urlDelMaster(MASTER)).toBeNull();
  });

  it("devuelve null si la URL no tiene forma de Storage público", () => {
    expect(urlDelMaster("https://otro-cdn.com/foto.jpg")).toBeNull();
    expect(urlDelMaster("no-es-una-url")).toBeNull();
  });
});

describe("leerImagenOrigen", () => {
  it("PREFIERE el master cuando existe, y no toca el original", async () => {
    const fetchMock = vi.fn(async (u) =>
      u === MASTER ? resp(true, "webp", "image/webp") : resp(true)
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await leerImagenOrigen(ORIG);
    expect(r.deMaster).toBe(true);
    expect(r.contentType).toBe("image/webp");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(MASTER);
  });

  it("cae al original si el master aún no existe, sin romper", async () => {
    // Es el estado normal mientras no se hayan generado: esto tiene que poder
    // desplegarse sin migrar nada.
    const fetchMock = vi.fn(async (u) => (u === MASTER ? resp(false) : resp(true)));
    vi.stubGlobal("fetch", fetchMock);
    const r = await leerImagenOrigen(ORIG);
    expect(r.deMaster).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("LAS VARIANTES DEL DÍA NO SE DESCARGAN N VECES", async () => {
    // El otro recorte de egress: 3 anchuras × 3 formatos × 6 zooms salen todas
    // del mismo original. Una instancia caliente debe descargarlo una vez.
    const fetchMock = vi.fn(async () => resp(true, "webp", "image/webp"));
    vi.stubGlobal("fetch", fetchMock);
    for (let i = 0; i < 10; i++) await leerImagenOrigen(ORIG);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("devuelve null si tampoco se puede con el original", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(false)));
    expect(await leerImagenOrigen(ORIG)).toBeNull();
  });

  it("un master que peta no impide servir la foto", async () => {
    const fetchMock = vi.fn(async (u) => {
      if (u === MASTER) throw new Error("storage raro");
      return resp(true);
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await leerImagenOrigen(ORIG);
    expect(r.deMaster).toBe(false);
  });
});
