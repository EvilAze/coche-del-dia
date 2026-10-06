// api/_lib/registro-puntos.test.js
// El reintento del registro de puntos. Lo que se prueba es lo que importa de
// verdad: que reintentar NUNCA le diga al jugador que no puntuó el día que sí, y
// que no se repita lo que no tiene sentido repetir.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { registrarResultadoDiario, esFalloDeServicio } from "./registro-puntos.js";

// Plazo diminuto: con el real (4 s) cada caso de «se atranca» tardaría 4 s.
const PLAZO = 15;
const nunca = () => new Promise(() => {}); // una dependencia que no contesta

// Lo que devuelve la RPC al registrar de verdad un acierto a la 3ª con racha 4.
const registrado = {
  basePoints: 4,
  streakBonus: 3,
  totalPoints: 7,
  currentStreak: 4,
  maxStreak: 9,
  totalScore: 120,
  alreadyRecorded: false,
};
// Y lo que devuelve DESPUÉS de haberlo registrado: ceros, pero el estado ya
// actualizado (racha 4, total 120).
const yaRegistrado = {
  basePoints: 0,
  streakBonus: 0,
  totalPoints: 0,
  currentStreak: 4,
  maxStreak: 9,
  totalScore: 120,
  alreadyRecorded: true,
};

const ok = (data) => ({ data, error: null, status: 200 });
const fallo = (status, code = "", message = "boom") => ({
  data: null,
  error: { code, message },
  status,
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("registrarResultadoDiario — el camino normal", () => {
  it("si contesta a la primera, devuelve eso y no reintenta", async () => {
    const llamar = vi.fn(async () => ok(registrado));
    const r = await registrarResultadoDiario(llamar, {
      won: true, attemptNumber: 3, plazo: PLAZO,
    });
    expect(r).toEqual(registrado);
    expect(llamar).toHaveBeenCalledTimes(1);
  });

  it("un «ya registrado» en el PRIMER intento se devuelve tal cual (no hay intento nuestro que lo explique)", async () => {
    const llamar = vi.fn(async () => ok(yaRegistrado));
    const r = await registrarResultadoDiario(llamar, {
      won: true, attemptNumber: 3, plazo: PLAZO,
    });
    expect(r).toEqual(yaRegistrado);
    expect(r.basePoints).toBe(0);
  });

  it("sin datos devuelve null (el handler lo trata como no persistido)", async () => {
    const llamar = vi.fn(async () => ok(null));
    expect(
      await registrarResultadoDiario(llamar, { won: true, attemptNumber: 3, plazo: PLAZO })
    ).toBeNull();
  });
});

describe("registrarResultadoDiario — el reintento", () => {
  it("el primer intento se atranca y el segundo contesta: devuelve el segundo", async () => {
    const llamar = vi
      .fn()
      .mockImplementationOnce(nunca)
      .mockImplementationOnce(async () => ok(registrado));
    const r = await registrarResultadoDiario(llamar, {
      won: true, attemptNumber: 3, plazo: PLAZO,
    });
    expect(r).toEqual(registrado);
    expect(llamar).toHaveBeenCalledTimes(2);
  });

  it("PIDE UNA LLAMADA NUEVA en cada intento (el query builder es perezoso y de un solo uso)", async () => {
    const fabricadas = [];
    const llamar = vi.fn(() => {
      const p = fabricadas.length === 0 ? nunca() : Promise.resolve(ok(registrado));
      fabricadas.push(p);
      return p;
    });
    await registrarResultadoDiario(llamar, { won: true, attemptNumber: 3, plazo: PLAZO });
    expect(fabricadas).toHaveLength(2);
    expect(fabricadas[0]).not.toBe(fabricadas[1]);
  });

  it("EL CASO CENTRAL: el primer intento sí se guardó pero su respuesta se perdió → se reconstruye la puntuación", async () => {
    const llamar = vi
      .fn()
      .mockImplementationOnce(nunca) // se guardó, pero no llegó la respuesta
      .mockImplementationOnce(async () => ok(yaRegistrado));
    const r = await registrarResultadoDiario(llamar, {
      won: true, attemptNumber: 3, plazo: PLAZO,
    });
    // Los números que habría devuelto el primer intento: 4 de base + 3 de racha.
    expect(r.basePoints).toBe(4);
    expect(r.streakBonus).toBe(3);
    expect(r.totalPoints).toBe(7);
    // El estado ya actualizado se conserva tal cual.
    expect(r.currentStreak).toBe(4);
    expect(r.maxStreak).toBe(9);
    expect(r.totalScore).toBe(120);
    // Esta petición SÍ lo registró.
    expect(r.alreadyRecorded).toBe(false);
  });

  it("la reconstrucción vale para cada intento y racha (10+0, 6+1, 4+2, 3+3, 2+3)", async () => {
    const casos = [
      { intento: 1, racha: 1, base: 10, bonus: 0 },
      { intento: 2, racha: 2, base: 6, bonus: 1 },
      { intento: 3, racha: 3, base: 4, bonus: 2 },
      { intento: 4, racha: 4, base: 3, bonus: 3 },
      { intento: 5, racha: 30, base: 2, bonus: 3 },
    ];
    for (const c of casos) {
      const llamar = vi
        .fn()
        .mockImplementationOnce(nunca)
        .mockImplementationOnce(async () =>
          ok({ ...yaRegistrado, currentStreak: c.racha })
        );
      const r = await registrarResultadoDiario(llamar, {
        won: true, attemptNumber: c.intento, plazo: PLAZO,
      });
      expect([r.basePoints, r.streakBonus, r.totalPoints]).toEqual([
        c.base, c.bonus, c.base + c.bonus,
      ]);
    }
  });

  it("una DERROTA reconstruida da cero y cero, y la racha rota se conserva", async () => {
    const llamar = vi
      .fn()
      .mockImplementationOnce(nunca)
      .mockImplementationOnce(async () =>
        ok({ ...yaRegistrado, currentStreak: 0 })
      );
    const r = await registrarResultadoDiario(llamar, {
      won: false, attemptNumber: 5, plazo: PLAZO,
    });
    expect([r.basePoints, r.streakBonus, r.totalPoints]).toEqual([0, 0, 0]);
    expect(r.currentStreak).toBe(0);
  });

  it("un 5xx se reintenta, y si el segundo contesta bien se devuelve", async () => {
    const llamar = vi
      .fn()
      .mockResolvedValueOnce(fallo(503, "", "upstream"))
      .mockResolvedValueOnce(ok(registrado));
    const r = await registrarResultadoDiario(llamar, {
      won: true, attemptNumber: 3, plazo: PLAZO,
    });
    expect(r).toEqual(registrado);
    expect(llamar).toHaveBeenCalledTimes(2);
  });

  it("la red caída (status 0) se reintenta", async () => {
    const llamar = vi
      .fn()
      .mockResolvedValueOnce(fallo(0, "", "TypeError: fetch failed"))
      .mockResolvedValueOnce(ok(registrado));
    await registrarResultadoDiario(llamar, { won: true, attemptNumber: 3, plazo: PLAZO });
    expect(llamar).toHaveBeenCalledTimes(2);
  });
});

describe("registrarResultadoDiario — lo que NO se reintenta", () => {
  it("un RAISE EXCEPTION de la RPC (400) es definitivo: se lanza al primer intento", async () => {
    const llamar = vi.fn(async () =>
      fallo(400, "P0001", "No game state for today")
    );
    await expect(
      registrarResultadoDiario(llamar, { won: true, attemptNumber: 3, plazo: PLAZO })
    ).rejects.toMatchObject({ code: "P0001" });
    expect(llamar).toHaveBeenCalledTimes(1);
  });

  it("un token caducado (401) tampoco se reintenta", async () => {
    const llamar = vi.fn(async () => fallo(401, "PGRST301", "JWT expired"));
    await expect(
      registrarResultadoDiario(llamar, { won: true, attemptNumber: 3, plazo: PLAZO })
    ).rejects.toMatchObject({ code: "PGRST301" });
    expect(llamar).toHaveBeenCalledTimes(1);
  });
});

describe("registrarResultadoDiario — cuando se agotan los intentos", () => {
  it("dos plazos vencidos → lanza el error del plazo (el handler lo marca como no persistido)", async () => {
    const llamar = vi.fn(nunca);
    await expect(
      registrarResultadoDiario(llamar, { won: true, attemptNumber: 3, plazo: PLAZO })
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(llamar).toHaveBeenCalledTimes(2);
  });

  it("dos 5xx → lanza el ÚLTIMO error", async () => {
    const llamar = vi
      .fn()
      .mockResolvedValueOnce(fallo(502, "", "primero"))
      .mockResolvedValueOnce(fallo(503, "", "segundo"));
    await expect(
      registrarResultadoDiario(llamar, { won: true, attemptNumber: 3, plazo: PLAZO })
    ).rejects.toMatchObject({ message: "segundo" });
    expect(llamar).toHaveBeenCalledTimes(2);
  });

  it("respeta el número de intentos pedido", async () => {
    const llamar = vi.fn(nunca);
    await expect(
      registrarResultadoDiario(llamar, {
        won: true, attemptNumber: 3, plazo: PLAZO, intentos: 1,
      })
    ).rejects.toBeDefined();
    expect(llamar).toHaveBeenCalledTimes(1);
  });
});

describe("esFalloDeServicio", () => {
  it("servicio: red caída, 408, 429 y 5xx", () => {
    for (const s of [0, 408, 429, 500, 502, 503, 504]) {
      expect(esFalloDeServicio(s, { code: "" })).toBe(true);
    }
  });

  it("respuesta definitiva: el resto de los 4xx", () => {
    for (const s of [400, 401, 403, 404, 409, 422]) {
      expect(esFalloDeServicio(s, { code: "P0001" })).toBe(false);
    }
  });

  it("sin status, manda el código: sin código es la red, con código es la base", () => {
    expect(esFalloDeServicio(undefined, { message: "x" })).toBe(true);
    expect(esFalloDeServicio(undefined, { code: "P0001" })).toBe(false);
  });
});
