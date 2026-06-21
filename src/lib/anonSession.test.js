// src/lib/anonSession.test.js
import { describe, it, expect, beforeEach, vi } from "vitest";

// vitest corre en entorno "node" → no hay localStorage. Lo stubbeamos.
function installLocalStorageStub() {
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  });
}

describe("anonSession", () => {
  beforeEach(() => {
    vi.resetModules();
    installLocalStorageStub();
  });

  it("getAnonToken devuelve '' si no hay nada", async () => {
    const { getAnonToken } = await import("./anonSession");
    expect(getAnonToken()).toBe("");
  });

  it("setAnonToken persiste y getAnonToken lo lee", async () => {
    const { getAnonToken, setAnonToken } = await import("./anonSession");
    setAnonToken("body.sig");
    expect(getAnonToken()).toBe("body.sig");
  });

  it("setAnonToken ignora valores vacíos o no-string", async () => {
    const { getAnonToken, setAnonToken } = await import("./anonSession");
    setAnonToken("");
    setAnonToken(null);
    setAnonToken(123);
    expect(getAnonToken()).toBe("");
  });

  it("anonHeaders incluye el header sólo si hay token", async () => {
    const { anonHeaders, setAnonToken, ANON_HEADER } = await import("./anonSession");
    expect(anonHeaders()).toEqual({});
    setAnonToken("body.sig");
    expect(anonHeaders()).toEqual({ [ANON_HEADER]: "body.sig" });
  });
});
