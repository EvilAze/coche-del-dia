// api/_lib/cifras.test.js
// Las cifras de la ficha técnica. Lo que se vigila es lo que fallaría sin
// avisar: que salgan del servidor perdiendo la partida (regla 5), que un hueco
// se pinte como un cero, que «1.500» se guarde como 2 CV, y que los rangos del
// código y los CHECK de la BD se separen.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  CIFRAS,
  CIFRAS_SELECT,
  cifrasDeFila,
  cifrasDelRevelado,
  parseCifra,
  cifrasDelBody,
} from "./cifras.js";

const def = (col) => CIFRAS.find((c) => c.col === col);
const FILA = { potencia_cv: 510, par_nm: 600, aceleracion_0_100: 3.9, vmax_kmh: 305 };

describe("cifrasDeFila", () => {
  it("traduce las columnas a las claves del reveal", () => {
    expect(cifrasDeFila(FILA)).toEqual({
      potenciaCv: 510,
      parNm: 600,
      aceleracion: 3.9,
      vmaxKmh: 305,
    });
  });

  it("deja fuera las que faltan, sin huecos ni ceros", () => {
    expect(cifrasDeFila({ potencia_cv: 75, par_nm: null, aceleracion_0_100: undefined, vmax_kmh: 150 }))
      .toEqual({ potenciaCv: 75, vmaxKmh: 150 });
  });

  it("devuelve null, no {}, si no hay ninguna (el cliente pregunta «¿hay ficha?»)", () => {
    expect(cifrasDeFila({ potencia_cv: null, par_nm: null, aceleracion_0_100: null, vmax_kmh: null })).toBeNull();
    expect(cifrasDeFila({})).toBeNull();
    expect(cifrasDeFila(null)).toBeNull();
  });

  it("acepta el numeric como texto y descarta lo que no es una cifra válida", () => {
    expect(cifrasDeFila({ aceleracion_0_100: "3.9" })).toEqual({ aceleracion: 3.9 });
    expect(cifrasDeFila({ potencia_cv: "abc", par_nm: NaN, vmax_kmh: 0 })).toBeNull();
  });
});

describe("cifrasDelRevelado — regla 5: la ficha es de quien gana", () => {
  it("con la partida ganada, las cifras", () => {
    expect(cifrasDelRevelado(FILA, true)).toEqual(cifrasDeFila(FILA));
  });

  it("perdiendo, nada — aunque el coche las tenga", () => {
    expect(cifrasDelRevelado(FILA, false)).toBeNull();
  });

  it("solo `true` abre la puerta: un valor «truthy» cualquiera no", () => {
    for (const casi of [1, "won", {}, undefined, null]) {
      expect(cifrasDelRevelado(FILA, casi)).toBeNull();
    }
  });
});

describe("parseCifra", () => {
  it("vacío o ausente = borrar la cifra", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(parseCifra(def("potencia_cv"), v)).toEqual({ value: null, error: null });
    }
  });

  it("acepta número o texto", () => {
    expect(parseCifra(def("potencia_cv"), 510)).toEqual({ value: 510, error: null });
    expect(parseCifra(def("potencia_cv"), " 510 ")).toEqual({ value: 510, error: null });
  });

  it("el 0-100 admite la coma decimal de quien escribe en español", () => {
    expect(parseCifra(def("aceleracion_0_100"), "3,9")).toEqual({ value: 3.9, error: null });
    expect(parseCifra(def("aceleracion_0_100"), "3.9")).toEqual({ value: 3.9, error: null });
    expect(parseCifra(def("aceleracion_0_100"), "12")).toEqual({ value: 12, error: null });
  });

  it("y redondea a su decimal", () => {
    expect(parseCifra(def("aceleracion_0_100"), "3,94").value).toBe(3.9);
    expect(parseCifra(def("aceleracion_0_100"), 3.96).value).toBe(4);
  });

  it("en los enteros NO acepta separadores: «1.500» no puede acabar siendo 2 CV", () => {
    for (const v of ["1.500", "1,500", "510,5", "510 CV", "-5"]) {
      const r = parseCifra(def("potencia_cv"), v);
      expect(r.value).toBeNull();
      expect(r.error).toMatch(/Potencia/);
    }
  });

  it("rechaza lo que se sale del rango, con la cifra en el mensaje", () => {
    expect(parseCifra(def("potencia_cv"), "0").error).toMatch(/fuera de rango/);
    expect(parseCifra(def("vmax_kmh"), 3050).error).toMatch(/Velocidad/);
    expect(parseCifra(def("aceleracion_0_100"), "0,5").error).toMatch(/fuera de rango/);
    expect(parseCifra(def("aceleracion_0_100"), "100").error).toMatch(/fuera de rango/);
  });

  it("rechaza tipos que no son número ni texto", () => {
    for (const v of [true, {}, [510], NaN, Infinity]) {
      expect(parseCifra(def("par_nm"), v).error).toBeTruthy();
    }
  });
});

describe("cifrasDelBody", () => {
  it("solo toca las columnas presentes", () => {
    expect(cifrasDelBody({ marca: "x", potencia_cv: "510" })).toEqual({
      patch: { potencia_cv: 510 },
      error: null,
    });
    expect(cifrasDelBody({ marca: "x" })).toEqual({ patch: {}, error: null });
  });

  it("la cadena vacía SÍ se escribe, como null: es la forma de quitar una cifra", () => {
    expect(cifrasDelBody({ vmax_kmh: "" })).toEqual({ patch: { vmax_kmh: null }, error: null });
  });

  it("un error en cualquiera para el guardado entero", () => {
    const r = cifrasDelBody({ potencia_cv: "510", par_nm: "6.000" });
    expect(r.error).toMatch(/Par/);
    expect(r.patch).toEqual({});
  });

  it("aguanta un body ausente", () => {
    expect(cifrasDelBody(undefined)).toEqual({ patch: {}, error: null });
  });
});

describe("réplica de los CHECK de la migración", () => {
  // Los rangos viven dos veces: aquí (para dar un error legible en el panel) y
  // en los CHECK de la BD (la última palabra). Si se separan, o el panel deja
  // pasar algo que la BD rechaza con un error críptico, o rechaza algo bueno.
  const sql = readFileSync(
    new URL("../../scripts/2026-10-ficha-tecnica-cifras.sql", import.meta.url),
    "utf8"
  );

  it.each(CIFRAS.map((c) => [c.col, c]))("%s: mismo rango en el SQL", (col, c) => {
    const re = new RegExp(`${col} IS NULL OR ${col} BETWEEN ([\\d.]+) AND ([\\d.]+)`);
    const m = sql.match(re);
    expect(m, `falta el CHECK de ${col}`).not.toBeNull();
    expect(Number(m[1])).toBe(c.min);
    expect(Number(m[2])).toBe(c.max);
  });

  it("el SELECT pide exactamente las columnas que crea la migración", () => {
    for (const c of CIFRAS) expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${c.col}`);
    expect(CIFRAS_SELECT).toBe("potencia_cv, par_nm, aceleracion_0_100, vmax_kmh");
  });

  it("y la migración no concede GRANT a ninguna (regla 5)", () => {
    expect(sql).not.toMatch(/^\s*GRANT/im);
  });
});
