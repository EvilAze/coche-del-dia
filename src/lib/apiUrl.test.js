// src/lib/apiUrl.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("apiUrl", () => {
  beforeEach(() => vi.resetModules());

  it("web (no nativo): deja las rutas /api relativas", async () => {
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => false },
    }));
    const { apiUrl } = await import("./apiUrl");
    expect(apiUrl("/api/get-daily-car")).toBe("/api/get-daily-car");
  });

  it("nativo: absolutiza /api con el origen de producción", async () => {
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => true },
    }));
    const { apiUrl, PROD_ORIGIN } = await import("./apiUrl");
    expect(apiUrl("/api/get-daily-car")).toBe(`${PROD_ORIGIN}/api/get-daily-car`);
  });

  it("nativo: no toca URLs que no empiezan por /api", async () => {
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => true },
    }));
    const { apiUrl } = await import("./apiUrl");
    expect(apiUrl("https://x.supabase.co/rest")).toBe("https://x.supabase.co/rest");
    expect(apiUrl("/brands/audi.png")).toBe("/brands/audi.png");
  });
});
