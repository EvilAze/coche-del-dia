import { describe, it, expect } from "vitest";
import { yearRange, MIN_YEAR } from "./yearRange";

// Atajo: un intento de año fallado con su dirección.
const fallo = (val, direction) => ({ anio: { val, status: "wrong", direction } });

describe("yearRange", () => {
  it("sin intentos, la horquilla es el rango entero y no está acotada", () => {
    const r = yearRange([], 2, 2026);
    expect(r).toEqual({ min: MIN_YEAR, max: 2026, acotada: false });
  });

  it("un fallo 'up' sube el mínimo SALTANDO la ventana de tolerancia", () => {
    // 2000 fallado y el real es mayor → 1998..2002 descartado → mínimo 2003.
    const r = yearRange([fallo(2000, "up")], 2, 2026);
    expect(r.min).toBe(2003);
    expect(r.max).toBe(2026);
    expect(r.acotada).toBe(true);
  });

  it("un fallo 'down' baja el máximo SALTANDO la ventana de tolerancia", () => {
    const r = yearRange([fallo(2010, "down")], 2, 2026);
    expect(r.min).toBe(MIN_YEAR);
    expect(r.max).toBe(2007);
  });

  it("acota por los dos lados y se queda con el extremo más estrecho", () => {
    const r = yearRange(
      [fallo(1990, "up"), fallo(2015, "down"), fallo(1998, "up")],
      2,
      2026
    );
    expect(r.min).toBe(2001); // el 1998 manda sobre el 1990
    expect(r.max).toBe(2012);
    expect(r.acotada).toBe(true);
  });

  it("la tolerancia 0 no salta ventana: solo descarta el año tecleado", () => {
    const r = yearRange([fallo(2000, "up")], 0, 2026);
    expect(r.min).toBe(2001);
  });

  it("ignora aciertos, intentos sin dirección y años ilegibles", () => {
    const r = yearRange(
      [
        { anio: { val: 2000, status: "correct", direction: null } },
        { anio: { val: 1995, status: "wrong", direction: null } },
        { anio: { val: "no-es-un-año", status: "wrong", direction: "up" } },
      ],
      2,
      2026
    );
    expect(r.acotada).toBe(false);
  });

  it("intentos contradictorios (min > max) caen al rango entero, sin mentir", () => {
    const r = yearRange([fallo(2015, "up"), fallo(1990, "down")], 2, 2026);
    expect(r).toEqual({ min: MIN_YEAR, max: 2026, acotada: false });
  });

  it("aguanta entradas basura sin lanzar", () => {
    expect(yearRange(null, 2, 2026).acotada).toBe(false);
    expect(yearRange([null, {}, { anio: null }], 2, 2026).acotada).toBe(false);
  });
});
