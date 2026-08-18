// src/lib/reminderSchedule.test.js
// La aritmética del recordatorio. Todo con `ahora` inyectado: sin esto habría
// que esperar a las 20:00 para saber si funciona.

import { describe, it, expect } from "vitest";
import { proximosAvisos, DIAS_VENTANA } from "./reminderSchedule";

// Helper: fecha local legible en las aserciones.
const local = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;

const HORA = 20;

describe("proximosAvisos", () => {
  it("por la mañana y sin jugar, el primero es HOY a la hora fijada", () => {
    const ahora = new Date(2026, 7, 18, 9, 30); // 18 ago, 09:30
    const [primero] = proximosAvisos({ ahora, hora: HORA });
    expect(local(primero)).toBe("2026-08-18 20:00");
  });

  // El caso que motivó todo el cambio.
  it("si ya jugó hoy, el primero es MAÑANA aunque sea por la mañana", () => {
    const ahora = new Date(2026, 7, 18, 9, 30);
    const [primero] = proximosAvisos({ ahora, yaJugoHoy: true, hora: HORA });
    expect(local(primero)).toBe("2026-08-19 20:00");
  });

  // Programar en el pasado es, según la versión de Android, un disparo
  // inmediato o ninguno. Ni uno ni otro es lo que queremos.
  it("pasada la hora, hoy ya no cuenta ni habiendo jugado ni sin jugar", () => {
    const ahora = new Date(2026, 7, 18, 21, 15);
    for (const yaJugoHoy of [false, true]) {
      const [primero] = proximosAvisos({ ahora, yaJugoHoy, hora: HORA });
      expect(local(primero)).toBe("2026-08-19 20:00");
    }
  });

  it("justo A la hora, hoy tampoco cuenta (el aviso sería simultáneo)", () => {
    const ahora = new Date(2026, 7, 18, 20, 0, 0);
    const [primero] = proximosAvisos({ ahora, hora: HORA });
    expect(local(primero)).toBe("2026-08-19 20:00");
  });

  it("devuelve la ventana entera, un aviso por día y en orden", () => {
    const ahora = new Date(2026, 7, 18, 9, 0);
    const avisos = proximosAvisos({ ahora, hora: HORA });
    expect(avisos).toHaveLength(DIAS_VENTANA);
    for (let i = 1; i < avisos.length; i++) {
      const dif = avisos[i].getTime() - avisos[i - 1].getTime();
      // Entre 23 y 25 horas: el cambio de horario hace que un salto NO sea de
      // 24 h exactas, y eso es correcto — la hora de pared se conserva.
      expect(dif).toBeGreaterThanOrEqual(23 * 3600 * 1000);
      expect(dif).toBeLessThanOrEqual(25 * 3600 * 1000);
    }
  });

  it("cruza el fin de mes sin inventarse un 32 de agosto", () => {
    const ahora = new Date(2026, 7, 30, 9, 0); // 30 ago
    const avisos = proximosAvisos({ ahora, hora: HORA, dias: 4 });
    expect(avisos.map(local)).toEqual([
      "2026-08-30 20:00",
      "2026-08-31 20:00",
      "2026-09-01 20:00",
      "2026-09-02 20:00",
    ]);
  });

  it("cruza el fin de año", () => {
    const ahora = new Date(2026, 11, 31, 9, 0);
    const avisos = proximosAvisos({ ahora, hora: HORA, dias: 2 });
    expect(avisos.map(local)).toEqual([
      "2026-12-31 20:00",
      "2027-01-01 20:00",
    ]);
  });

  // La hora de PARED es lo que importa: quien pone el aviso a las 20:00 lo
  // quiere a las 20:00 en octubre y en julio, no una hora antes porque haya
  // cambiado el horario de verano. Solo se comprueba donde el test corre en
  // una zona con DST; si no, la aserción sigue siendo cierta trivialmente.
  it("mantiene las 20:00 de pared al cruzar el cambio de hora", () => {
    const ahora = new Date(2026, 9, 20, 9, 0); // 20 oct, antes del cambio
    const avisos = proximosAvisos({ ahora, hora: HORA, dias: 14 });
    for (const a of avisos) {
      expect(a.getHours()).toBe(20);
      expect(a.getMinutes()).toBe(0);
    }
  });

  it("todos los avisos son futuros", () => {
    const ahora = new Date(2026, 7, 18, 19, 59);
    for (const a of proximosAvisos({ ahora, hora: HORA })) {
      expect(a.getTime()).toBeGreaterThan(ahora.getTime());
    }
  });
});
