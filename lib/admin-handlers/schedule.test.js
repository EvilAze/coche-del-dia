// lib/admin-handlers/schedule.test.js
// El botón «Aleatorizar» pasó a ser liberar + volver a sortear con
// pick_daily_car (antes barajaba en JS y se saltaba la temática de la
// temporada). Ese cambio le hereda los daños irreversibles del DELETE: liberar
// HOY cambiaría el coche a gente que ya está jugando, y liberar el PASADO
// destruiría el histórico del que cuelgan El Archivo, los logros y las stats.
//
// De ahí este fichero: la propiedad que hay que sostener es que el lote empieza
// en MAÑANA, pase lo que pase con las constantes del handler.

import { describe, it, expect } from "vitest";
import { randomizeBatchDates } from "./schedule.js";

const TODAY = "2026-08-17";
const MAX = "2026-08-30"; // hoy + 13: la ventana de 14 días que pinta el panel

describe("randomizeBatchDates", () => {
  it("son seis días y empiezan mañana", () => {
    expect(randomizeBatchDates({ today: TODAY, maxDate: MAX })).toEqual([
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
    ]);
  });

  it("nunca incluye hoy ni ninguna fecha pasada", () => {
    const dates = randomizeBatchDates({ today: TODAY, maxDate: MAX });
    expect(dates).not.toContain(TODAY);
    for (const date of dates) {
      expect(date > TODAY).toBe(true);
    }
  });

  it("aunque le pidan empezar antes, el guard corta", () => {
    // El bucle arranca en hoy+1, pero quien lo garantiza de verdad es
    // validateFreeDate: pedir 40 días no acerca el lote ni un día a hoy.
    const dates = randomizeBatchDates({ today: TODAY, maxDate: MAX, days: 40 });
    expect(dates[0]).toBe("2026-08-18");
    expect(dates).not.toContain(TODAY);
  });

  it("no se sale de la ventana visible del panel", () => {
    // Programar más allá de lo que el panel pinta sería una asignación
    // fantasma: el admin no la ve, así que no puede corregirla.
    expect(
      randomizeBatchDates({ today: TODAY, maxDate: "2026-08-20" })
    ).toEqual(["2026-08-18", "2026-08-19", "2026-08-20"]);
  });

  it("cuenta bien a través del cambio de mes y de año", () => {
    expect(
      randomizeBatchDates({ today: "2026-08-29", maxDate: "2026-09-11", days: 3 })
    ).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);

    expect(
      randomizeBatchDates({ today: "2026-12-30", maxDate: "2027-01-12", days: 3 })
    ).toEqual(["2026-12-31", "2027-01-01", "2027-01-02"]);
  });
});
