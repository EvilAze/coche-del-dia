// La frase del veredicto: lo que se siente tiene que ir con lo que se ve.
// Estos tests atan las tres cosas que se separan en silencio — el patrón de
// vibración, el compás de la tinta y el instante en que el sello toca el papel —
// porque ninguna de ellas rompe el build si se desafina: solo deja de sentirse
// como una sola cosa.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { MS } from "./compas";
import {
  PASO_VEREDICTO_MS,
  fraseVeredicto,
  IMPACTO_SELLO,
  MS_HASTA_IMPACTO_SELLO,
} from "./veredicto";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const leer = (...ruta) => readFileSync(join(RAIZ, ...ruta), "utf8");

const intento = (marca, modelo, anio) => ({
  marca: { status: marca },
  modelo: { status: modelo },
  anio: { status: anio },
});

describe("fraseVeredicto", () => {
  it("un acierto completo son tres golpes firmes, a compás", () => {
    expect(fraseVeredicto(intento("correct", "correct", "correct"))).toEqual([14, 96, 14, 96, 14]);
  });

  it("cada celda pesa según su veredicto: parcial, fallo, acierto", () => {
    expect(fraseVeredicto(intento("partial", "wrong", "correct"))).toEqual([10, 100, 6, 104, 14]);
  });

  it("acertado pesa más que parcial, y parcial más que fallo", () => {
    const [correcto] = fraseVeredicto(intento("correct", "wrong", "wrong"));
    const [parcial] = fraseVeredicto(intento("partial", "wrong", "wrong"));
    const [fallo] = fraseVeredicto(intento("wrong", "wrong", "wrong"));
    expect(correcto).toBeGreaterThan(parcial);
    expect(parcial).toBeGreaterThan(fallo);
  });

  it("un estado desconocido o ausente suena como un fallo, nunca rompe", () => {
    expect(fraseVeredicto(intento("raro", undefined, null))).toEqual([6, 104, 6, 104, 6]);
    expect(fraseVeredicto(null)).toEqual([6, 104, 6, 104, 6]);
  });

  it("cada golpe arranca exactamente donde cae su celda (0 · 110 · 220)", () => {
    for (const st of [["correct", "partial", "wrong"], ["wrong", "correct", "partial"]]) {
      const [a, p1, b, p2] = fraseVeredicto(intento(...st));
      expect(p1).toBeGreaterThanOrEqual(0);
      expect(p2).toBeGreaterThanOrEqual(0);
      expect(a + p1).toBe(PASO_VEREDICTO_MS);
      expect(a + p1 + b + p2).toBe(2 * PASO_VEREDICTO_MS);
    }
  });

  it("la frase termina antes de que la foto empiece a abrirse", () => {
    // El cuarto tiempo de la frase es la fotografía, en `MS.sello`. Si el
    // último golpe se le echa encima, el tacto pisa el único movimiento que el
    // jugador está mirando.
    const patron = fraseVeredicto(intento("correct", "correct", "correct"));
    const fin = patron.reduce((total, ms) => total + ms, 0);
    expect(fin).toBeLessThanOrEqual(MS.sello);
  });
});

describe("la tinta y el tacto leen el mismo compás", () => {
  it("AttemptList escalona las celdas con PASO_VEREDICTO_MS, no con un número propio", () => {
    const fuente = leer("src", "components", "configurator", "AttemptList.jsx");
    expect(fuente).toMatch(/PASO_VEREDICTO_MS/);
    expect(fuente).not.toMatch(/const STAGGER_MS\s*=\s*\d/);
  });
});

describe("el golpe del sello", () => {
  // Resuelve una cubic-bezier CSS (x1, y1, x2, y2) y devuelve el primer
  // instante (0..1) en que el progreso alcanza 1: el contacto del sello.
  function primerContacto([x1, y1, x2, y2]) {
    const bez = (p1, p2, s) => 3 * (1 - s) ** 2 * s * p1 + 3 * (1 - s) * s ** 2 * p2 + s ** 3;
    for (let s = 0; s <= 1; s += 0.0005) {
      if (bez(y1, y2, s) >= 1) return bez(x1, x2, s);
    }
    return 1;
  }

  it("IMPACTO_SELLO coincide con la --curva-sello de index.css", () => {
    const m = leer("src", "index.css").match(/--curva-sello:\s*cubic-bezier\(([^)]+)\)/);
    expect(m).not.toBeNull();
    const curva = m[1].split(",").map(Number);
    expect(Math.abs(primerContacto(curva) - IMPACTO_SELLO)).toBeLessThan(0.015);
  });

  it("el sello dura --ms-escena, que es con lo que se calcula el golpe", () => {
    // `.prensa-sello` anima prensaSellar con var(--ms-escena): si cambia de
    // peldaño, el golpe se calcularía sobre una duración que ya no es la suya.
    expect(leer("src", "index.css")).toMatch(/\.prensa-sello\s*\{[^}]*animation:\s*prensaSellar var\(--ms-escena\)/);
    expect(MS_HASTA_IMPACTO_SELLO).toBe(Math.round(MS.escena * IMPACTO_SELLO));
  });
});
