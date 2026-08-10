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
    expect(n.REMINDER_HOUR).toBe(20);
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
    expect(arg.schedule.on).toEqual({ hour: n.REMINDER_HOUR, minute: 0 });
  });

  it("nativo: crea el canal propio, borra el huérfano y etiqueta el aviso", async () => {
    const schedule = vi.fn().mockResolvedValue();
    const createChannel = vi.fn().mockResolvedValue();
    const deleteChannel = vi.fn().mockResolvedValue();
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => true },
    }));
    vi.doMock("@capacitor/local-notifications", () => ({
      LocalNotifications: {
        checkPermissions: vi.fn().mockResolvedValue({ display: "granted" }),
        requestPermissions: vi.fn().mockResolvedValue({ display: "granted" }),
        schedule,
        cancel: vi.fn().mockResolvedValue(),
        createChannel,
        deleteChannel,
      },
    }));
    const n = await import("./notifications");
    await n.rearmIfEnabled({
      title: "t",
      body: "b",
      channelName: "Recordatorio diario",
      channelDescription: "Un aviso al día.",
    });

    expect(createChannel).toHaveBeenCalledTimes(1);
    expect(createChannel.mock.calls[0][0]).toMatchObject({
      id: n.REMINDER_CHANNEL_ID,
      name: "Recordatorio diario",
      // LOW, no DEFAULT: se ve pero no suena. Es una decisión de producto
      // (juego casual, el opt-in promete "sin spam"), y Android congela la
      // importancia al crear el canal — subirla luego sin querer solo se
      // notaría en instalaciones nuevas y ya sería irreversible desde la app.
      importance: 2,
    });
    // El canal "Default" que planta el plugin se retira para que no quede un
    // interruptor mudo en los ajustes del móvil.
    expect(deleteChannel).toHaveBeenCalledWith({ id: "default" });
    // Y el aviso tiene que ir POR el canal nuevo; si no, el interruptor bonito
    // no controlaría nada.
    expect(schedule.mock.calls[0][0].notifications[0].channelId).toBe(
      n.REMINDER_CHANNEL_ID
    );
  });

  it("nativo con plugin viejo (sin createChannel): programa igual", async () => {
    const schedule = vi.fn().mockResolvedValue();
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => true },
    }));
    // Sin createChannel/deleteChannel: simula Android < 8 o una versión del
    // plugin sin la API de canales. La programación NO puede caerse por eso.
    vi.doMock("@capacitor/local-notifications", () => ({
      LocalNotifications: {
        checkPermissions: vi.fn().mockResolvedValue({ display: "granted" }),
        requestPermissions: vi.fn().mockResolvedValue({ display: "granted" }),
        schedule,
        cancel: vi.fn().mockResolvedValue(),
      },
    }));
    const n = await import("./notifications");
    await expect(
      n.rearmIfEnabled({ title: "t", body: "b", channelName: "x" })
    ).resolves.toBeUndefined();
    expect(schedule).toHaveBeenCalledTimes(1);
    // CLAVE: sin canal creado NO se puede etiquetar el aviso con su channelId.
    // Android 8+ descarta en silencio las notificaciones dirigidas a un canal
    // inexistente, así que hacerlo cambiaría "nombre feo en los ajustes" por
    // "el recordatorio no llega nunca".
    expect(
      schedule.mock.calls[0][0].notifications[0].channelId
    ).toBeUndefined();
  });

  it("nativo sin nombre de canal: no lo crea y no etiqueta el aviso", async () => {
    const schedule = vi.fn().mockResolvedValue();
    const createChannel = vi.fn().mockResolvedValue();
    vi.doMock("@capacitor/core", () => ({
      Capacitor: { isNativePlatform: () => true },
    }));
    vi.doMock("@capacitor/local-notifications", () => ({
      LocalNotifications: {
        checkPermissions: vi.fn().mockResolvedValue({ display: "granted" }),
        requestPermissions: vi.fn().mockResolvedValue({ display: "granted" }),
        schedule,
        cancel: vi.fn().mockResolvedValue(),
        createChannel,
        deleteChannel: vi.fn().mockResolvedValue(),
      },
    }));
    const n = await import("./notifications");
    // Un caller que no pasa el copy del canal (i18n a medias, llamada antigua):
    // Android exige nombre, así que ni se intenta.
    await n.rearmIfEnabled({ title: "t", body: "b" });
    expect(createChannel).not.toHaveBeenCalled();
    expect(schedule.mock.calls[0][0].notifications[0].channelId).toBeUndefined();
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
