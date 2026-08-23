// api/_lib/jwks.test.js
// Tests de la caché de claves públicas. Lo que hay que demostrar son las dos
// propiedades de las que depende que la autenticación siga en pie:
//   1. la verificación es LOCAL de verdad (no se pide el JWKS por petición), y
//   2. sigue habiendo claves aunque GoTrue —que es quien las sirve— esté caído.
// La (2) es la que faltaba en la primera versión y la que la estrelló.
import { describe, it, expect, vi, beforeEach } from "vitest";

const redisMock = { get: vi.fn(), set: vi.fn() };
let hayRedis = true;
vi.mock("./ratelimit.js", () => ({
  getRedis: () => (hayRedis ? redisMock : null),
}));

const { getJwks, _resetJwksCache } = await import("./jwks.js");
const { default: EMBEBIDAS } = await import("./jwks-embebido.js");

const CLAVES = { keys: [{ kid: "k1", alg: "ES256" }] };
const OTRAS = { keys: [{ kid: "k1" }, { kid: "k2" }] };

function respuesta(json, ok = true, status = 200) {
  return { ok, status, json: async () => json };
}

beforeEach(() => {
  _resetJwksCache();
  hayRedis = true;
  redisMock.get.mockReset().mockResolvedValue(null);
  redisMock.set.mockReset().mockResolvedValue("OK");
  process.env.SUPABASE_URL = "https://proyecto.supabase.co";
  process.env.SUPABASE_ANON_KEY = "sb_publishable_x";
  vi.restoreAllMocks();
});

describe("verificación local de verdad", () => {
  it("pide las claves la primera vez y NO vuelve a pedirlas", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta(CLAVES));
    vi.stubGlobal("fetch", fetchMock);
    await getJwks({ kid: "k1" });
    await getJwks({ kid: "k1" });
    await getJwks({ kid: "k1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://proyecto.supabase.co/auth/v1/.well-known/jwks.json"
    );
  });

  it("N llamadas concurrentes en frío → UNA sola lectura", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta(CLAVES));
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([getJwks(), getJwks(), getJwks(), getJwks()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("un kid DESCONOCIDO fuerza refresco aunque el TTL siga vivo", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuesta(CLAVES))
      .mockResolvedValueOnce(respuesta(OTRAS));
    vi.stubGlobal("fetch", fetchMock);
    await getJwks({ kid: "k1" });
    const r = await getJwks({ kid: "k2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.keys.map((k) => k.kid)).toEqual(["k1", "k2"]);
  });
});

describe("sobrevive a una caída de GoTrue", () => {
  it("REDIS ANTES QUE EL ORIGEN: con claves en Redis no se toca la red", async () => {
    // El caso que motiva todo el nivel L2: GoTrue caído, instancia en frío, y
    // aun así la autenticación funciona.
    redisMock.get.mockResolvedValue(CLAVES);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getJwks({ kid: "k1" })).toEqual(CLAVES);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("una lectura buena SIEMBRA Redis para el resto de la flota", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(CLAVES)));
    await getJwks();
    expect(redisMock.set).toHaveBeenCalledWith(
      "jwks:v1",
      JSON.stringify(CLAVES),
      expect.objectContaining({ ex: expect.any(Number) })
    );
  });

  it("Redis vacío o caído → se sigue por el origen, sin romper", async () => {
    redisMock.get.mockRejectedValue(new Error("upstash down"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(CLAVES)));
    expect(await getJwks()).toEqual(CLAVES);
  });

  it("tras un fallo NO se reintenta en cada petición (backoff)", async () => {
    // Sin esto, con GoTrue caído cada petición autenticada pagaba el plazo
    // entero del fetch ANTES de caer al respaldo: latencia de más para un
    // usuario que ya lo estaba pasando mal.
    const fetchMock = vi.fn().mockRejectedValue(new Error("gotrue caído"));
    vi.stubGlobal("fetch", fetchMock);
    await getJwks();
    await getJwks();
    await getJwks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ROTACION: un Redis obsoleto no bloquea la clave nueva", async () => {
    // Sin esto nos quedariamos clavados en la copia de Redis hasta que expire
    // -30 dias- y ningun token firmado con la clave nueva verificaria.
    redisMock.get.mockResolvedValue(CLAVES); // solo k1
    const fetchMock = vi.fn().mockResolvedValue(respuesta(OTRAS)); // k1 + k2
    vi.stubGlobal("fetch", fetchMock);
    const r = await getJwks({ kid: "k2" });
    expect(fetchMock).toHaveBeenCalled();
    expect(r.keys.map((k) => k.kid)).toContain("k2");
  });

  it("si el refresco falla se conserva la caché anterior, no se vacía", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuesta(CLAVES))
      .mockRejectedValueOnce(new Error("red caída"));
    vi.stubGlobal("fetch", fetchMock);
    await getJwks({ kid: "k1" });
    const r = await getJwks({ kid: "desconocido" });
    expect(r).toEqual(CLAVES);
  });
});

describe("el suelo: SIEMPRE hay claves", () => {
  it("las embebidas son claves publicas de verdad, sin material privado", () => {
    // Van commiteadas en un repo PUBLICO: si algun dia alguien pega ahi un
    // JWKS completo con la parte privada, esto lo caza.
    expect(EMBEBIDAS.keys.length).toBeGreaterThan(0);
    for (const k of EMBEBIDAS.keys) {
      expect(k.key_ops).toEqual(["verify"]);
      expect(k).not.toHaveProperty("d");
      expect(k).not.toHaveProperty("p");
      expect(k).not.toHaveProperty("q");
    }
  });

  it("sin envs se sigue verificando con las embebidas", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.REACT_APP_SUPABASE_URL;
    vi.stubGlobal("fetch", vi.fn());
    expect(await getJwks()).toEqual(EMBEBIDAS);
  });

  it("CON GOTRUE Y REDIS CAIDOS A LA VEZ, sigue habiendo claves", async () => {
    // Es exactamente el escenario del 23 de agosto de 2026, en el que las dos
    // versiones anteriores de este modulo se quedaban sin nada que hacer.
    redisMock.get.mockRejectedValue(new Error("upstash down"));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("gotrue down")));
    const r = await getJwks({ kid: EMBEBIDAS.keys[0].kid });
    expect(r.keys.length).toBeGreaterThan(0);
    expect(r).toEqual(EMBEBIDAS);
  });

  it("un HTTP de error no deja a nadie sin claves", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(null, false, 503)));
    expect(await getJwks()).toEqual(EMBEBIDAS);
  });

  it("sin Upstash configurado sigue funcionando por el origen", async () => {
    hayRedis = false;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(CLAVES)));
    expect(await getJwks()).toEqual(CLAVES);
  });
});
