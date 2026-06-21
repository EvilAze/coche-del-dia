// src/lib/reminderCopy.test.js
import { describe, it, expect } from "vitest";
import { reminderCopy, STREAK_NUDGE_MIN } from "./reminderCopy";

// Mocks de t/tn que devuelven la key (+ count) para verificar la SELECCIÓN
// de copy, no el texto traducido.
const t = (key) => key;
const tn = (key, count) => `${key}#${count}`;

describe("reminderCopy", () => {
  it("racha 0 (anónimo / sin racha) → copy genérico", () => {
    expect(reminderCopy(t, tn, 0)).toEqual({
      title: "notif.reminderTitle",
      body: "notif.reminderBody",
    });
  });

  it("racha 1 (por debajo del umbral) → copy genérico", () => {
    expect(reminderCopy(t, tn, 1)).toEqual({
      title: "notif.reminderTitle",
      body: "notif.reminderBody",
    });
  });

  it("racha >= umbral → copy de racha con el count", () => {
    expect(STREAK_NUDGE_MIN).toBe(2);
    expect(reminderCopy(t, tn, 5)).toEqual({
      title: "notif.streakReminderTitle",
      body: "notif.streakReminderBody#5",
    });
  });

  it("streak ausente/no numérico → genérico (defensivo)", () => {
    expect(reminderCopy(t, tn, undefined)).toEqual({
      title: "notif.reminderTitle",
      body: "notif.reminderBody",
    });
  });
});
