// src/lib/reminderCopy.test.js
import { describe, it, expect } from "vitest";
import { reminderCopy, STREAK_NUDGE_MIN } from "./reminderCopy";

// Mocks de t/tn que devuelven la key (+ count) para verificar la SELECCIÓN
// de copy, no el texto traducido.
const t = (key) => key;
const tn = (key, count) => `${key}#${count}`;

// El canal de Android es uno solo y su copy no depende de la racha: va en todas
// las respuestas. Se extrae aquí para no repetirlo en cada aserción.
const CANAL = {
  channelName: "notif.channelName",
  channelDescription: "notif.channelDescription",
};

// El copy genérico viaja SIEMPRE, además del que toque: desde que el
// recordatorio es una ventana de días sueltos, solo el aviso más cercano puede
// llevar un número de racha cierto, y el resto caen a este.
const GENERICO = {
  generico: {
    title: "notif.reminderTitle",
    body: "notif.reminderBody",
  },
};

describe("reminderCopy", () => {
  it("racha 0 (anónimo / sin racha) → copy genérico", () => {
    expect(reminderCopy(t, tn, 0)).toEqual({
      ...CANAL,
      ...GENERICO,
      title: "notif.reminderTitle",
      body: "notif.reminderBody",
    });
  });

  it("racha 1 (por debajo del umbral) → copy genérico", () => {
    expect(reminderCopy(t, tn, 1)).toEqual({
      ...CANAL,
      ...GENERICO,
      title: "notif.reminderTitle",
      body: "notif.reminderBody",
    });
  });

  it("racha >= umbral → copy de racha con el count", () => {
    expect(STREAK_NUDGE_MIN).toBe(2);
    expect(reminderCopy(t, tn, 5)).toEqual({
      ...CANAL,
      ...GENERICO,
      title: "notif.streakReminderTitle",
      body: "notif.streakReminderBody#5",
    });
  });

  it("streak ausente/no numérico → genérico (defensivo)", () => {
    expect(reminderCopy(t, tn, undefined)).toEqual({
      ...CANAL,
      ...GENERICO,
      title: "notif.reminderTitle",
      body: "notif.reminderBody",
    });
  });

  // El nombre del canal es lo que el usuario ve en los ajustes de
  // notificaciones del móvil: no puede cambiar según la racha del día, o el
  // interruptor se llamaría distinto cada semana.
  it("el copy del canal NO depende de la racha", () => {
    const sinRacha = reminderCopy(t, tn, 0);
    const conRacha = reminderCopy(t, tn, 9);
    expect(conRacha.channelName).toBe(sinRacha.channelName);
    expect(conRacha.channelDescription).toBe(sinRacha.channelDescription);
    // …pero el aviso en sí sí cambia (si no, este test no probaría nada).
    expect(conRacha.title).not.toBe(sinRacha.title);
  });

  // Lo que hace posible la ventana: con racha, el aviso cercano habla de la
  // racha y el genérico sigue disponible para los días de después, donde ese
  // número ya no sería cierto.
  it("con racha, `generico` sigue siendo el copy neutro", () => {
    const conRacha = reminderCopy(t, tn, 9);
    expect(conRacha.title).toBe("notif.streakReminderTitle");
    expect(conRacha.generico).toEqual({
      title: "notif.reminderTitle",
      body: "notif.reminderBody",
    });
  });
});
