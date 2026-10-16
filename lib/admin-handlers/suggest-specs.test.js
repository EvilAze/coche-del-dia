import { describe, it, expect } from "vitest";
import {
  consensoCifras,
  dentroDeTolerancia,
  extraerJson,
  leerVoto,
} from "./suggest-specs.js";

// Coches INVENTADOS a propósito (regla 20: nada de valores por coche real en
// el repo). Lo que se prueba es la política, no la ficha de nadie.
const voto = (cifras, version = "Fantasía GT serie 1") =>
  leerVoto({ version, ...cifras });

const BASE = { potencia_cv: 400, par_nm: 450, aceleracion_0_100: 4.2, vmax_kmh: 300 };

describe("dentroDeTolerancia", () => {
  it("acepta hasta un 3 % en CV, Nm y km/h, medido contra el menor", () => {
    expect(dentroDeTolerancia("potencia_cv", 400, 412)).toBe(true); // 3,0 %
    expect(dentroDeTolerancia("potencia_cv", 412, 400)).toBe(true); // orden indiferente
    expect(dentroDeTolerancia("potencia_cv", 400, 413)).toBe(false);
    expect(dentroDeTolerancia("par_nm", 500, 515)).toBe(true);
    expect(dentroDeTolerancia("vmax_kmh", 300, 310)).toBe(false); // 3,3 %
  });

  it("acepta hasta 0,3 s en el 0-100, sin que la coma flotante deje fuera el borde", () => {
    expect(dentroDeTolerancia("aceleracion_0_100", 4.5, 4.8)).toBe(true);
    expect(dentroDeTolerancia("aceleracion_0_100", 4.5, 4.9)).toBe(false);
  });
});

describe("extraerJson", () => {
  it("lee JSON pelado, envuelto en ```json o con una frase delante", () => {
    expect(extraerJson('{"a":1}')).toEqual({ a: 1 });
    expect(extraerJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extraerJson('Aquí tienes: {"a":1}')).toEqual({ a: 1 });
  });

  it("devuelve null con basura, arrays o nada", () => {
    expect(extraerJson("no sé")).toBeNull();
    expect(extraerJson("[1,2]")).toBeNull();
    expect(extraerJson(undefined)).toBeNull();
  });
});

describe("leerVoto", () => {
  it("valida con los rangos de cifras.js y convierte lo que no pase en abstención", () => {
    const v = leerVoto({
      version: "  Fantasía  GT\nserie 2 ",
      potencia_cv: 99999, // fuera de rango
      par_nm: "450 Nm", // con unidades
      aceleracion_0_100: "4,2", // coma decimal: válida
      vmax_kmh: null,
    });
    expect(v.version).toBe("Fantasía GT serie 2");
    expect(v.cifras).toEqual({
      potencia_cv: null,
      par_nm: null,
      aceleracion_0_100: 4.2,
      vmax_kmh: null,
    });
  });

  it("no redondea a escondidas un entero con decimales, pero acepta «400.0»", () => {
    expect(leerVoto({ potencia_cv: 400.5 }).cifras.potencia_cv).toBeNull();
    expect(leerVoto({ potencia_cv: "400.0" }).cifras.potencia_cv).toBe(400);
    expect(leerVoto({ potencia_cv: 400.0 }).cifras.potencia_cv).toBe(400);
  });

  it("devuelve null si no hay objeto", () => {
    expect(leerVoto(null)).toBeNull();
  });
});

describe("consensoCifras", () => {
  it("sugiere las cifras en las que los dos votos coinciden", () => {
    const r = consensoCifras({ groq: voto(BASE), gemini: voto(BASE) });
    expect(r.sugerencias).toEqual(BASE);
    expect(r.detalle.every((d) => d.estado === "consenso")).toBe(true);
    expect(r.versionesDistintas).toBe(false);
  });

  it("dentro de tolerancia sugiere la conservadora, no la media", () => {
    const r = consensoCifras({
      groq: voto({ ...BASE, potencia_cv: 410, aceleracion_0_100: 4.0 }),
      gemini: voto({ ...BASE, potencia_cv: 400, aceleracion_0_100: 4.2 }),
    });
    expect(r.sugerencias.potencia_cv).toBe(400);
    expect(r.sugerencias.aceleracion_0_100).toBe(4.2);
    const cv = r.detalle.find((d) => d.col === "potencia_cv");
    expect(cv.motivo).toMatch(/Groq 410 \/ Gemini 400/);
  });

  it("deja vacía y explica una cifra en la que discrepan", () => {
    const r = consensoCifras({
      groq: voto({ ...BASE, potencia_cv: 400 }),
      gemini: voto({ ...BASE, potencia_cv: 420 }),
    });
    expect(r.sugerencias.potencia_cv).toBeNull();
    const cv = r.detalle.find((d) => d.col === "potencia_cv");
    expect(cv.estado).toBe("discrepan");
    expect(cv.motivo).toBe("No coinciden: Groq 400 / Gemini 420.");
    // Una sola discrepancia no tumba las demás.
    expect(r.sugerencias.par_nm).toBe(450);
    expect(r.versionesDistintas).toBe(false);
  });

  it("con dos o más discrepancias no sugiere ninguna: hablan de versiones distintas", () => {
    // Dos series del mismo coche inventado: potencia y par claramente
    // distintos, y el 0-100 y la punta caen dentro de tolerancia por
    // casualidad. Justo el caso en que «coinciden» no significa «es correcto».
    const r = consensoCifras({
      groq: voto({ potencia_cv: 330, par_nm: 340, aceleracion_0_100: 5.1, vmax_kmh: 290 }, "serie 1"),
      gemini: voto({ potencia_cv: 352, par_nm: 360, aceleracion_0_100: 4.9, vmax_kmh: 294 }, "serie 2"),
    });
    expect(r.versionesDistintas).toBe(true);
    expect(Object.values(r.sugerencias).every((v) => v === null)).toBe(true);
    expect(r.detalle.every((d) => d.estado === "discrepan")).toBe(true);
  });

  it("si uno da null en una cifra, esa queda vacía (abstención)", () => {
    const r = consensoCifras({
      groq: voto({ ...BASE, par_nm: null }),
      gemini: voto(BASE),
    });
    expect(r.sugerencias.par_nm).toBeNull();
    const par = r.detalle.find((d) => d.col === "par_nm");
    expect(par.estado).toBe("abstencion");
    expect(par.motivo).toMatch(/Groq/);
    expect(r.sugerencias.potencia_cv).toBe(400);
  });

  it("sin uno de los dos votos no sugiere nada, aunque el otro lo tenga todo", () => {
    const r = consensoCifras({ groq: voto(BASE), gemini: null });
    expect(Object.values(r.sugerencias).every((v) => v === null)).toBe(true);
    expect(r.detalle.every((d) => d.estado === "sin-voto")).toBe(true);
    // Pero conserva lo que dijo el que sí votó, para enseñarlo como dato.
    expect(r.detalle.find((d) => d.col === "potencia_cv").groq).toBe(400);
  });

  it("una cifra que no pasa la validación cuenta como abstención, no como voto", () => {
    const r = consensoCifras({
      groq: voto({ ...BASE, vmax_kmh: 9999 }),
      gemini: voto({ ...BASE, vmax_kmh: 9999 }),
    });
    expect(r.sugerencias.vmax_kmh).toBeNull();
    expect(r.detalle.find((d) => d.col === "vmax_kmh").estado).toBe("abstencion");
  });
});
