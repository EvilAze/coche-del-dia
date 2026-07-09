// src/lib/rankMovement.test.js
import { describe, it, expect } from "vitest";
import { rankMovement } from "./rankMovement";

describe("rankMovement", () => {
  it("sin objeto de puesto → unranked", () => {
    expect(rankMovement(null)).toEqual({ kind: "unranked" });
  });

  it("rank null (logueado sin puesto) → unranked", () => {
    expect(rankMovement({ rank: null, total: 128 })).toEqual({ kind: "unranked" });
  });

  it("sin baseline (delta null) → new, conservando puesto y total", () => {
    expect(rankMovement({ rank: 15, total: 128, delta: null, isNew: true })).toEqual({
      kind: "new",
      pos: 15,
      total: 128,
    });
  });

  it("isNew aunque venga delta → new (no hay ayer con el que comparar)", () => {
    expect(rankMovement({ rank: 15, total: 128, delta: 3, isNew: true })).toEqual({
      kind: "new",
      pos: 15,
      total: 128,
    });
  });

  it("delta > 0 → up con n positivo (ha subido)", () => {
    expect(rankMovement({ rank: 12, total: 128, delta: 3, isNew: false })).toEqual({
      kind: "up",
      pos: 12,
      total: 128,
      n: 3,
    });
  });

  it("delta < 0 → down con n positivo (ha bajado)", () => {
    expect(rankMovement({ rank: 18, total: 128, delta: -2, isNew: false })).toEqual({
      kind: "down",
      pos: 18,
      total: 128,
      n: 2,
    });
  });

  it("delta === 0 → hold", () => {
    expect(rankMovement({ rank: 15, total: 128, delta: 0, isNew: false })).toEqual({
      kind: "hold",
      pos: 15,
      total: 128,
    });
  });
});
