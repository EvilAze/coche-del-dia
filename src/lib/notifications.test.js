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

  // Helper: monta los mocks nativos con permiso concedido y devuelve los spies.
  function montarNativo() {
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
    return { schedule, cancel };
  }

  it("programa una VENTANA de avisos sueltos, no una repeticion", async () => {
    const { schedule } = montarNativo();
    const n = await import("./notifications");
    const { DIAS_VENTANA } = await import("./reminderSchedule");

    await n.rearmIfEnabled({ title: "Hoy hay coche", body: "Juega" });

    const avisos = schedule.mock.calls[0][0].notifications;
    expect(avisos).toHaveLength(DIAS_VENTANA);
    // `at` (disparo unico con fecha) y NUNCA `on` (repeticion): `on` no se
    // puede saltar un dia, que es justo lo que veniamos a arreglar.
    for (const a of avisos) {
      expect(a.schedule.at instanceof Date).toBe(true);
      expect(a.schedule.on).toBeUndefined();
    }
    expect(avisos[0].id).toBe(n.REMINDER_ID);
  });

  // EL CASO QUE MOTIVO EL CAMBIO: jugar por la manana no debe costarte un aviso
  // por la tarde diciendote que no pierdas la racha que ya aseguraste.
  it("si ya jugo hoy, el primer aviso NO es hoy", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 7, 18, 9, 30)); // 18 ago, 09:30
      const { schedule } = montarNativo();
      const n = await import("./notifications");

      await n.rearmIfEnabled({ title: "t", body: "b", yaJugoHoy: true });

      const primero = schedule.mock.calls[0][0].notifications[0].schedule.at;
      expect(primero.getDate()).toBe(19);
      expect(primero.getHours()).toBe(n.REMINDER_HOUR);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sin haber jugado y antes de la hora, el primer aviso SI es hoy", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 7, 18, 9, 30));
      const { schedule } = montarNativo();
      const n = await import("./notifications");

      await n.rearmIfEnabled({ title: "t", body: "b", yaJugoHoy: false });

      const primero = schedule.mock.calls[0][0].notifications[0].schedule.at;
      expect(primero.getDate()).toBe(18);
    } finally {
      vi.useRealTimers();
    }
  });

  // Sin esto, quien actualice la app se queda con la repeticion vieja (id 1)
  // sonando cada tarde PARA SIEMPRE, ademas de la ventana nueva.
  it("cancela todo el rango de ids, incluido el heredado", async () => {
    const { cancel } = montarNativo();
    const n = await import("./notifications");
    const { DIAS_VENTANA } = await import("./reminderSchedule");

    await n.rearmIfEnabled({ title: "t", body: "b" });

    const cancelados = cancel.mock.calls[0][0].notifications.map((x) => x.id);
    expect(cancelados).toHaveLength(DIAS_VENTANA);
    expect(cancelados).toContain(n.REMINDER_ID);
  });

  it("solo el aviso mas cercano habla de la racha; el resto, generico", async () => {
    const { schedule } = montarNativo();
    const n = await import("./notifications");

    await n.rearmIfEnabled({
      title: "No pierdas tu racha de 48 dias",
      body: "cuerpo con racha",
      generico: { title: "Hoy hay coche", body: "cuerpo neutro" },
    });

    const avisos = schedule.mock.calls[0][0].notifications;
    expect(avisos[0].title).toBe("No pierdas tu racha de 48 dias");
    // El numero se congela al programar: para pasado manana solo seria cierto
    // si juega manana, y si juega la app se abre y reprograma.
    for (const a of avisos.slice(1)) {
      expect(a.title).toBe("Hoy hay coche");
      expect(a.body).toBe("cuerpo neutro");
    }
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
