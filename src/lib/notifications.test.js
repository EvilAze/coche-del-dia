// src/lib/notifications.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("notifications", () => {
  beforeEach(() => vi.resetModules());

  it("en web (no nativo) las operaciones son no-op y no lanzan", async () => {
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => false },
    }));
    const n = await import("./notifications");
    expect(n.isNative()).toBe(false);
    await expect(n.scheduleDailyReminder({ title: "t", body: "b" })).resolves.toBeUndefined();
    await expect(n.rearmIfEnabled({ title: "t", body: "b" })).resolves.toBeUndefined();
    expect(n.REMINDER_HOUR).toBe(10);
  });

  it("nativo + permiso concedido: rearmIfEnabled programa con id fijo", async () => {
    const schedule = vi.fn().mockResolvedValue();
    const cancel = vi.fn().mockResolvedValue();
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => true },
    }));
    vi.doMock("@capacitor/local-notifications", () => ({
      LocalNotifications: {
        checkPermissions: vi.fn().mockResolvedValue({ display: "granted" }),
        requestPermissions: vi.fn().mockResolvedValue({ display: "granted" }),
        schedule,
        cancel,
      },
    }));
    const n = await import("./notifications");
    await n.rearmIfEnabled({ title: "Hoy hay coche", body: "Juega" });
    expect(schedule).toHaveBeenCalledTimes(1);
    const arg = schedule.mock.calls[0][0].notifications[0];
    expect(arg.id).toBe(n.REMINDER_ID);
    expect(arg.schedule.on).toEqual({ hour: 10, minute: 0 });
  });

  it("nativo + permiso denegado: rearmIfEnabled NO programa", async () => {
    const schedule = vi.fn().mockResolvedValue();
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => true },
    }));
    vi.doMock("@capacitor/local-notifications", () => ({
      LocalNotifications: {
        checkPermissions: vi.fn().mockResolvedValue({ display: "denied" }),
        requestPermissions: vi.fn(),
        schedule,
        cancel: vi.fn().mockResolvedValue(),
      },
    }));
    const n = await import("./notifications");
    await n.rearmIfEnabled({ title: "t", body: "b" });
    expect(schedule).not.toHaveBeenCalled();
  });
});
