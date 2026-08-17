import { describe, it, expect } from "vitest";
import { repescaActiva, puedeSortear } from "./activa.js";

const HOY = "2026-08-17";
const AYER = "2026-08-16";
const COCHE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("repescaActiva", () => {
  it("devuelve coche y fecha juntos", () => {
    expect(
      repescaActiva({ last_repesca_at: HOY, last_repesca_car_id: COCHE })
    ).toEqual({ carId: COCHE, fecha: HOY });
  });

  // El caso que motivó el helper: la partida NO caduca a medianoche. La fecha
  // que devuelve es la del sorteo, y con ella se localiza la fila de
  // user_guesses aunque el día natural ya haya cambiado.
  it("una partida sorteada ayer sigue siendo la activa", () => {
    expect(
      repescaActiva({ last_repesca_at: AYER, last_repesca_car_id: COCHE })
    ).toEqual({ carId: COCHE, fecha: AYER });
  });

  it("sin fila, sin coche o sin fecha no hay repesca activa", () => {
    expect(repescaActiva(null)).toBeNull();
    expect(repescaActiva(undefined)).toBeNull();
    expect(repescaActiva({})).toBeNull();
    expect(repescaActiva({ last_repesca_at: HOY })).toBeNull();
    expect(repescaActiva({ last_repesca_car_id: COCHE })).toBeNull();
  });
});

describe("puedeSortear", () => {
  it("no se sortea dos veces el mismo día", () => {
    expect(puedeSortear({ carId: COCHE, fecha: HOY }, HOY)).toBe(false);
  });

  it("al cambiar el día vuelve a haber sorteo", () => {
    expect(puedeSortear({ carId: COCHE, fecha: AYER }, HOY)).toBe(true);
  });

  it("quien no ha sorteado nunca, puede", () => {
    expect(puedeSortear(null, HOY)).toBe(true);
  });
});
