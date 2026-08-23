// api/_lib/jwks.test.js
// Tests de la caché de claves públicas. Lo que importa demostrar es que la
// verificación es LOCAL de verdad: si esto pidiera el JWKS por red en cada
// petición, habríamos cambiado un viaje a /auth/v1/user por otro viaje, que
// era exactamente el problema que veníamos a quitar.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getJwks, _resetJwksCache } from "./jwks.js";

const CLAVES = { keys: [{ kid: "k1", alg: "ES256" }] };

function respuesta(json, ok = true, status = 200) {
  return { ok, status, json: async () => json };
}

beforeEach(() => {
  _resetJwksCache();
  process.env.SUPABASE_URL = "https://proyecto.supabase.co";
  process.env.SUPABASE_ANON_KEY = "sb_publishable_x";
  vi.restoreAllMocks();
});

describe("getJwks", () => {
  it("pide las claves la primera vez", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta(CLAVES));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getJwks()).toEqual(CLAVES);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://proyecto.supabase.co/auth/v1/.well-known/jwks.json"
    );
  });

  it("NO vuelve a pedirlas mientras la caché sirva", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta(CLAVES));
    vi.stubGlobal("fetch", fetchMock);
    await getJwks({ kid: "k1" });
    await getJwks({ kid: "k1" });
    await getJwks({ kid: "k1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("N llamadas concurrentes en frío → UNA sola lectura", async () => {
    // Una instancia que arranca en frío atendiendo varias peticiones a la vez
    // no debe disparar N lecturas del JWKS.
    const fetchMock = vi.fn().mockResolvedValue(respuesta(CLAVES));
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([getJwks(), getJwks(), getJwks(), getJwks()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("un kid DESCONOCIDO fuerza refresco aunque el TTL siga vivo", async () => {
    // Es como se absorbe una rotación de claves sin esperar una hora.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuesta(CLAVES))
      .mockResolvedValueOnce(respuesta({ keys: [{ kid: "k1" }, { kid: "k2" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await getJwks({ kid: "k1" });
    const r = await getJwks({ kid: "k2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.keys.map((k) => k.kid)).toEqual(["k1", "k2"]);
  });

  it("si el refresco falla se conserva la caché anterior, no se vacía", async () => {
    // Un JWKS que no se puede refrescar no debe tumbar la autenticación
    // mientras las claves que ya teníamos sigan sirviendo.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuesta(CLAVES))
      .mockRejectedValueOnce(new Error("red caída"));
    vi.stubGlobal("fetch", fetchMock);
    await getJwks({ kid: "k1" });
    const r = await getJwks({ kid: "desconocido" });
    expect(r).toEqual(CLAVES);
  });

  it("no lanza nunca: sin envs devuelve claves vacías", async () => {
    // Claves vacías hace que el llamante caiga a getUser(), que es el
    // comportamiento de antes: degradar, no romper.
    delete process.env.SUPABASE_URL;
    delete process.env.REACT_APP_SUPABASE_URL;
    vi.stubGlobal("fetch", vi.fn());
    expect(await getJwks()).toEqual({ keys: [] });
  });

  it("no lanza nunca: un HTTP de error deja las claves vacías", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(null, false, 503)));
    expect(await getJwks()).toEqual({ keys: [] });
  });
});
