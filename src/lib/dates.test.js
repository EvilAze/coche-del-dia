import { describe, it, expect } from "vitest";
import { getMadridDateStr, isStreakAlive } from "./dates";

describe("getMadridDateStr", () => {
  it("formatea YYYY-MM-DD en zona Madrid", () => {
    // 10:00 UTC en junio (Madrid CEST = UTC+2) → mismo día.
    expect(getMadridDateStr(new Date("2026-06-03T10:00:00Z"))).toBe("2026-06-03");
  });

  it("respeta el cambio de día por zona horaria", () => {
    // 23:30 UTC → 01:30 del día siguiente en Madrid (UTC+2).
    expect(getMadridDateStr(new Date("2026-06-03T23:30:00Z"))).toBe("2026-06-04");
  });

  it("invierno aplica UTC+1 (CET)", () => {
    // 23:30 UTC en enero (Madrid CET = UTC+1) → 00:30 del día siguiente.
    expect(getMadridDateStr(new Date("2026-01-10T23:30:00Z"))).toBe("2026-01-11");
  });
});

describe("isStreakAlive", () => {
  // "Ahora" fijo: 2026-06-03 12:00 Madrid.
  const now = new Date("2026-06-03T10:00:00Z");

  it("falso si no hay fecha", () => {
    expect(isStreakAlive(null, now)).toBe(false);
    expect(isStreakAlive(undefined, now)).toBe(false);
    expect(isStreakAlive("", now)).toBe(false);
  });

  it("viva si jugó hoy", () => {
    expect(isStreakAlive("2026-06-03", now)).toBe(true);
  });

  it("viva si jugó ayer", () => {
    expect(isStreakAlive("2026-06-02", now)).toBe(true);
  });

  it("rota si jugó anteayer", () => {
    expect(isStreakAlive("2026-06-01", now)).toBe(false);
  });

  it("rota si la fecha es futura (defensa)", () => {
    expect(isStreakAlive("2026-06-04", now)).toBe(false);
  });

  it("cruza fin de mes correctamente (hoy día 1 → ayer último del mes previo)", () => {
    const firstOfMonth = new Date("2026-07-01T10:00:00Z"); // Madrid 2026-07-01
    expect(isStreakAlive("2026-06-30", firstOfMonth)).toBe(true);
    expect(isStreakAlive("2026-06-29", firstOfMonth)).toBe(false);
  });

  // Retirado el escudo de racha (agosto 2026), la regla no tiene excepciones:
  // hoy o ayer, y punto. Este test defiende justo eso — que un tercer argumento
  // olvidado en algún caller no reviva la indulgencia por la puerta de atrás.
  it("ignora argumentos de más: un hueco de un día rompe la racha igual", () => {
    expect(isStreakAlive("2026-06-01", now, 2)).toBe(false);
  });
});
