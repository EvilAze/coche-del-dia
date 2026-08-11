import { describe, it, expect } from "vitest";
import { repescaJugada } from "./consumo.js";

describe("repescaJugada", () => {
  // El caso que motivó la regla: sorteo apuntado en stats, navegación rota,
  // cero intentos. Antes esto contaba como repesca gastada.
  it("un sorteo que nunca llegó a jugarse NO gasta la repesca", () => {
    expect(repescaJugada(null)).toBe(false);
    expect(repescaJugada(undefined)).toBe(false);
    expect(repescaJugada({ status: "playing", guesses: [] })).toBe(false);
  });

  it("un intento basta para darla por gastada", () => {
    expect(repescaJugada({ status: "playing", guesses: [{ win: false }] })).toBe(true);
  });

  it("una partida cerrada cuenta aunque los intentos lleguen ilegibles", () => {
    expect(repescaJugada({ status: "won", guesses: null })).toBe(true);
    expect(repescaJugada({ status: "lost", guesses: "no-json" })).toBe(true);
  });

  // `guesses` es jsonb, pero el SQL de temporadas castea `guesses::jsonb`:
  // señal de que la columna no siempre viaja tipada.
  it("acepta los intentos como texto JSON", () => {
    expect(repescaJugada({ status: "playing", guesses: '[{"win":false}]' })).toBe(true);
    expect(repescaJugada({ status: "playing", guesses: "[]" })).toBe(false);
  });

  it("no revienta con basura", () => {
    expect(repescaJugada({ status: "playing", guesses: "{" })).toBe(false);
    expect(repescaJugada({ status: "playing", guesses: 42 })).toBe(false);
  });
});
