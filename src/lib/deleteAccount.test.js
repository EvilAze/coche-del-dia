// src/lib/deleteAccount.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// El módulo arrastra supabaseClient (exige envs) y auth.js (exige capacitor,
// que no está instalado en el worktree), así que ambos van mockeados y el
// módulo se carga con import() dinámico. Mismo patrón que webpush.test.js.
const signOut = vi.fn(async () => ({ error: null }));
let sesion = { access_token: "jwt-de-prueba" };

function mockearDependencias() {
  vi.doMock("../supabaseClient", () => ({
    supabase: { auth: { getSession: async () => ({ data: { session: sesion } }) } },
  }));
  vi.doMock("./auth", () => ({ signOut }));
}

function almacenFalso(inicial = {}) {
  const datos = { ...inicial };
  return {
    datos,
    removeItem: (k) => delete datos[k],
  };
}

describe("deleteAccount", () => {
  beforeEach(() => {
    sesion = { access_token: "jwt-de-prueba" };
    signOut.mockClear();
    mockearDependencias();
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.doUnmock("../supabaseClient");
    vi.doUnmock("./auth");
  });

  it("limpiarEstadoLocal borra las claves de la cuenta y respeta las demás", async () => {
    const { limpiarEstadoLocal, CLAVES_LOCALES } = await import("./deleteAccount.js");
    const store = almacenFalso({
      cocheDia_state: "{}",
      cd_anon_token: "tok",
      "cdd-tema": "noche", // preferencia del dispositivo, NO dato de cuenta
    });

    limpiarEstadoLocal(store);

    for (const clave of CLAVES_LOCALES) expect(store.datos[clave]).toBeUndefined();
    expect(store.datos["cdd-tema"]).toBe("noche");
  });

  it("limpiarEstadoLocal no revienta si el almacenamiento lanza", async () => {
    const { limpiarEstadoLocal } = await import("./deleteAccount.js");
    const roto = {
      removeItem: () => {
        throw new Error("modo privado");
      },
    };
    expect(() => limpiarEstadoLocal(roto)).not.toThrow();
  });

  it("solicitarBorrado manda el JWT en Authorization", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchSpy);

    const { solicitarBorrado } = await import("./deleteAccount.js");
    const res = await solicitarBorrado();

    expect(res).toEqual({ ok: true });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/delete-account");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer jwt-de-prueba");
  });

  it("solicitarBorrado no llama al servidor sin sesión", async () => {
    sesion = null;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { solicitarBorrado } = await import("./deleteAccount.js");
    const res = await solicitarBorrado();

    expect(res).toEqual({ ok: false, motivo: "sin_sesion" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("solicitarBorrado propaga el código de error del servidor", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: "rate_limited" }),
    }));

    const { solicitarBorrado } = await import("./deleteAccount.js");
    expect(await solicitarBorrado()).toEqual({ ok: false, motivo: "rate_limited" });
  });

  it("eliminarCuenta NO cierra sesión ni recarga si el servidor falla", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "db_error" }),
    }));
    const recargar = vi.fn();

    const { eliminarCuenta } = await import("./deleteAccount.js");
    const res = await eliminarCuenta({ recargar });

    expect(res).toEqual({ ok: false, motivo: "db_error" });
    expect(signOut).not.toHaveBeenCalled();
    expect(recargar).not.toHaveBeenCalled();
  });

  it("eliminarCuenta recarga aunque signOut falle (la cuenta ya no existe)", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ ok: true }) }));
    signOut.mockRejectedValueOnce(new Error("sin red"));
    const recargar = vi.fn();

    const { eliminarCuenta } = await import("./deleteAccount.js");
    const res = await eliminarCuenta({ recargar });

    expect(res).toEqual({ ok: true });
    expect(recargar).toHaveBeenCalledTimes(1);
  });
});
