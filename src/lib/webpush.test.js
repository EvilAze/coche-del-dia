// src/lib/webpush.test.js
import { describe, it, expect, vi, afterEach } from "vitest";

// Igual que notifications.test.js: capacitor NO está instalado en el worktree,
// así que lo mockeamos por test y cargamos el módulo con import() dinámico.
describe("webpush", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@capacitor/core");
  });

  it("urlBase64ToUint8Array convierte la clave VAPID", async () => {
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => false },
    }));
    const { urlBase64ToUint8Array } = await import("./webpush.js");
    // Clave base64url válida (codifica "hello")
    const out = urlBase64ToUint8Array("aGVsbG8");
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(0);
  });

  it("isPushSupported es false en nativo (la app usa notif locales)", async () => {
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => true },
    }));
    const { isPushSupported } = await import("./webpush.js");
    expect(isPushSupported()).toBe(false);
  });

  it("isPushSupported es false en web sin PushManager", async () => {
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => false },
    }));
    const { isPushSupported } = await import("./webpush.js");
    // jsdom no trae PushManager ni serviceWorker → debe dar false sin lanzar.
    expect(isPushSupported()).toBe(false);
  });

  it("subscribe no lanza y devuelve false si no hay soporte", async () => {
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => false },
    }));
    const { subscribe } = await import("./webpush.js");
    await expect(subscribe("es")).resolves.toBe(false);
  });
});
