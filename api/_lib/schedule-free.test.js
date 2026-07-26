// api/_lib/schedule-free.test.js
// El caso que de verdad importa aquí no es el camino feliz: es que HOY y el
// PASADO no se puedan liberar nunca. Liberar hoy cambiaría el coche a gente
// que está jugando; liberar el pasado destruiría el histórico del que cuelgan
// El Archivo, los logros y las estadísticas.

import { describe, it, expect } from "vitest";
import {
  validateFreeDate,
  draftsAllowedFor,
  daysBetween,
  MIN_DRAFT_OFFSET_DAYS,
} from "./schedule-free.js";

const TODAY = "2026-07-26";
const MAX = "2026-08-08"; // hoy + 13 (ventana de 14 días del panel)

const call = (date) => validateFreeDate({ date, today: TODAY, maxDate: MAX });

describe("validateFreeDate — lo que NO se puede liberar", () => {
  it("hoy no se libera (hay partidas en curso)", () => {
    const r = call(TODAY);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(r.error).toContain("hoy");
  });

  it("el pasado no se libera (es el histórico)", () => {
    for (const d of ["2026-07-25", "2026-01-01", "2020-12-31"]) {
      const r = call(d);
      expect(r.ok).toBe(false);
      expect(r.status).toBe(409);
    }
  });

  it("hoy y el pasado dan mensajes distintos", () => {
    // Motivos distintos → explicaciones distintas. Si el admin ve el mismo
    // texto para ambos, no entiende por qué uno de los dos falla.
    expect(call(TODAY).error).not.toBe(call("2026-07-25").error);
  });

  it("más allá de la ventana visible no se libera", () => {
    const r = call("2026-08-09");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it("rechaza formatos inválidos sin tocar nada", () => {
    for (const d of ["", "  ", "26-07-2026", "2026-7-6", "mañana", null, undefined, 20260727, {}]) {
      const r = call(d);
      expect(r.ok).toBe(false);
      expect(r.status).toBe(400);
    }
  });
});

describe("validateFreeDate — lo que sí", () => {
  it("mañana es el primer día liberable", () => {
    expect(call("2026-07-27")).toEqual({ ok: true, date: "2026-07-27" });
  });

  it("el último día de la ventana es liberable", () => {
    expect(call(MAX)).toEqual({ ok: true, date: MAX });
  });

  it("recorta espacios alrededor", () => {
    expect(call("  2026-07-27  ")).toEqual({ ok: true, date: "2026-07-27" });
  });
});

describe("daysBetween", () => {
  it("cuenta días de calendario", () => {
    expect(daysBetween("2026-07-26", "2026-07-27")).toBe(1);
    expect(daysBetween("2026-07-26", "2026-07-26")).toBe(0);
    expect(daysBetween("2026-07-26", "2026-08-08")).toBe(13);
  });

  it("cuenta bien a través de mes y año", () => {
    expect(daysBetween("2026-07-31", "2026-08-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("es negativo hacia atrás y null con basura", () => {
    expect(daysBetween("2026-07-27", "2026-07-26")).toBe(-1);
    expect(daysBetween("mañana", "2026-07-26")).toBeNull();
    expect(daysBetween("2026-07-26", null)).toBeNull();
  });
});

describe("draftsAllowedFor — margen para subir la foto", () => {
  const today = TODAY; // 2026-07-26

  it("mañana NO puede recibir un coche sin foto", () => {
    // Menos de 24 h para subir la imagen, y ninguna ventaja frente a usar
    // pasado mañana: si se le pasa, la jornada queda injugable.
    expect(draftsAllowedFor({ date: "2026-07-27", today })).toBe(false);
  });

  it("pasado mañana sí", () => {
    expect(draftsAllowedFor({ date: "2026-07-28", today })).toBe(true);
  });

  it("hoy y el pasado tampoco", () => {
    expect(draftsAllowedFor({ date: today, today })).toBe(false);
    expect(draftsAllowedFor({ date: "2026-07-20", today })).toBe(false);
  });

  it("el resto de la ventana sí", () => {
    expect(draftsAllowedFor({ date: "2026-08-08", today })).toBe(true);
  });

  it("ante fechas inválidas falla hacia lo seguro (solo coches con foto)", () => {
    for (const date of ["", "mañana", null, undefined, 20260728]) {
      expect(draftsAllowedFor({ date, today })).toBe(false);
    }
  });

  it("respeta el margen configurado", () => {
    expect(MIN_DRAFT_OFFSET_DAYS).toBe(2);
    expect(
      draftsAllowedFor({ date: "2026-07-27", today, minOffsetDays: 1 })
    ).toBe(true);
  });
});

describe("validateFreeDate — cruces de mes y de año", () => {
  it("compara bien a través del cambio de mes", () => {
    // La comparación es lexicográfica sobre YYYY-MM-DD; estos son los casos
    // donde un parseo a Date descuidado se equivocaría.
    const r = validateFreeDate({
      date: "2026-08-01",
      today: "2026-07-31",
      maxDate: "2026-08-13",
    });
    expect(r).toEqual({ ok: true, date: "2026-08-01" });
  });

  it("compara bien a través del cambio de año", () => {
    const ok = validateFreeDate({
      date: "2027-01-01",
      today: "2026-12-31",
      maxDate: "2027-01-13",
    });
    expect(ok.ok).toBe(true);

    const past = validateFreeDate({
      date: "2026-12-31",
      today: "2027-01-01",
      maxDate: "2027-01-14",
    });
    expect(past.ok).toBe(false);
    expect(past.status).toBe(409);
  });
});
