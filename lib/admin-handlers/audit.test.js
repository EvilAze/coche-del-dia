// lib/admin-handlers/audit.test.js
// Tests del time-to-win del panel de auditoría.
//
// Por qué existe este fichero: la columna t→win salía «0s» en rojo para casi
// todos los jugadores y nadie podía saber que era un artefacto. El cálculo
// recortaba con Math.max(0, …) las visitas registradas DESPUÉS de la victoria
// (el session_start de la partida empezando se perdía, ver logSessionStart), y
// un dato roto se leía como «gana en cero segundos». Un detector de trampas que
// acusa a todo el mundo con la misma cifra es peor que no tener detector.

import { describe, it, expect } from "vitest";
import { medianasTimeToWin } from "./audit.js";

// Atajos para no repetir el objeto fila en cada caso.
const inicio = (user_id, game_date, ts) => ({ user_id, game_date, ts, mode: "session_start", win: false });
const victoria = (user_id, game_date, ts) => ({ user_id, game_date, ts, mode: "daily", win: true });
const intento = (user_id, game_date, ts) => ({ user_id, game_date, ts, mode: "daily", win: false });

describe("medianasTimeToWin", () => {
  it("mide la visita que abrió la partida contra la victoria", () => {
    const r = medianasTimeToWin([
      inicio("u1", "2026-10-20", "2026-10-20T10:00:00Z"),
      victoria("u1", "2026-10-20", "2026-10-20T10:00:45Z"),
    ]);
    expect(r.get("u1")).toEqual({ medianSec: 45, n: 1, min: 45, max: 45 });
  });

  it("una visita registrada DESPUÉS de ganar no es una medición: se descarta, no se pone a 0", () => {
    // Es el caso real de producción: el session_start de la partida empezando
    // no se guardó y el único que hay es el de volver a ver el resultado.
    const r = medianasTimeToWin([
      victoria("u1", "2026-10-20", "2026-10-20T06:13:00Z"),
      inicio("u1", "2026-10-20", "2026-10-20T12:04:00Z"),
    ]);
    expect(r.has("u1")).toBe(false);
  });

  it("un jugador con días medibles y no medibles solo cuenta los medibles", () => {
    const r = medianasTimeToWin([
      // Día medible: 30 s.
      inicio("u1", "2026-10-20", "2026-10-20T10:00:00Z"),
      victoria("u1", "2026-10-20", "2026-10-20T10:00:30Z"),
      // Día roto: la visita llega después de ganar.
      victoria("u1", "2026-10-21", "2026-10-21T06:00:00Z"),
      inicio("u1", "2026-10-21", "2026-10-21T09:00:00Z"),
    ]);
    expect(r.get("u1")).toEqual({ medianSec: 30, n: 1, min: 30, max: 30 });
  });

  it("victoria y visita en el mismo instante sí es una medición válida de 0 s", () => {
    // El recorte a 0 ocultaba justo esta distinción: 0 real frente a negativo.
    const r = medianasTimeToWin([
      inicio("u1", "2026-10-20", "2026-10-20T10:00:00Z"),
      victoria("u1", "2026-10-20", "2026-10-20T10:00:00Z"),
    ]);
    expect(r.get("u1")).toEqual({ medianSec: 0, n: 1, min: 0, max: 0 });
  });

  it("con varias visitas el día manda la MÁS TEMPRANA, y con varias victorias la primera", () => {
    const r = medianasTimeToWin([
      inicio("u1", "2026-10-20", "2026-10-20T10:05:00Z"),
      inicio("u1", "2026-10-20", "2026-10-20T10:00:00Z"),
      victoria("u1", "2026-10-20", "2026-10-20T10:02:00Z"),
      victoria("u1", "2026-10-20", "2026-10-20T11:00:00Z"),
    ]);
    expect(r.get("u1").medianSec).toBe(120);
  });

  it("calcula la mediana por usuario (impar y par)", () => {
    const dias = [
      ["2026-10-20", 10],
      ["2026-10-21", 50],
      ["2026-10-22", 20],
    ];
    const filas = dias.flatMap(([d, s]) => [
      inicio("u1", d, `${d}T10:00:00Z`),
      victoria("u1", d, `${d}T10:00:${String(s).padStart(2, "0")}Z`),
    ]);
    expect(medianasTimeToWin(filas).get("u1")).toMatchObject({ medianSec: 20, n: 3, min: 10, max: 50 });

    // Par: la mediana es la media de los dos centrales, redondeada.
    const par = medianasTimeToWin(filas.slice(0, 4));
    expect(par.get("u1")).toMatchObject({ medianSec: 30, n: 2 });
  });

  it("los intentos sin victoria y los días sin visita no producen medición", () => {
    const r = medianasTimeToWin([
      inicio("u1", "2026-10-20", "2026-10-20T10:00:00Z"),
      intento("u1", "2026-10-20", "2026-10-20T10:01:00Z"),
      victoria("u2", "2026-10-20", "2026-10-20T10:01:00Z"),
    ]);
    expect(r.size).toBe(0);
  });

  it("separa a los usuarios y los días", () => {
    const r = medianasTimeToWin([
      inicio("u1", "2026-10-20", "2026-10-20T10:00:00Z"),
      victoria("u1", "2026-10-20", "2026-10-20T10:00:10Z"),
      inicio("u2", "2026-10-20", "2026-10-20T10:00:00Z"),
      victoria("u2", "2026-10-20", "2026-10-20T10:02:00Z"),
    ]);
    expect(r.get("u1").medianSec).toBe(10);
    expect(r.get("u2").medianSec).toBe(120);
  });

  it("sin filas devuelve un mapa vacío", () => {
    expect(medianasTimeToWin([]).size).toBe(0);
    expect(medianasTimeToWin(null).size).toBe(0);
  });
});
