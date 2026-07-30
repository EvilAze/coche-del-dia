// src/i18n/locales.test.js
// Paridad entre es.json y en.json.
//
// Por qué hace falta: `t()` devuelve la CLAVE cuando no encuentra la
// traducción, así que un olvido no revienta nada — simplemente le enseña
// "offline.titleServer" al usuario en mitad de la pantalla. Es un fallo mudo
// (el peor tipo: se ve en producción, no en el build) y el único momento en que
// se detecta es cuando alguien cambia de idioma, que es justo lo que menos se
// prueba.
//
// El test no juzga la calidad de la traducción, solo que EXISTA en ambos y con
// la misma forma.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import es from "./locales/es.json";
import en from "./locales/en.json";

/** Rutas de todas las hojas del objeto, en notación "a.b.c". */
function rutas(obj, prefijo = "") {
  const salida = [];
  for (const [clave, valor] of Object.entries(obj)) {
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    if (valor && typeof valor === "object" && !Array.isArray(valor)) {
      salida.push(...rutas(valor, ruta));
    } else {
      salida.push(ruta);
    }
  }
  return salida.sort();
}

describe("locales", () => {
  const rutasEs = rutas(es);
  const rutasEn = rutas(en);

  it("es.json y en.json tienen exactamente las mismas claves", () => {
    const faltanEnIngles = rutasEs.filter((r) => !rutasEn.includes(r));
    const faltanEnEspanol = rutasEn.filter((r) => !rutasEs.includes(r));
    expect({ faltanEnIngles, faltanEnEspanol }).toEqual({
      faltanEnIngles: [],
      faltanEnEspanol: [],
    });
  });

  it("ninguna traducción está vacía", () => {
    const vacias = [];
    for (const [locale, dict] of [["es", es], ["en", en]]) {
      for (const ruta of rutas(dict)) {
        const valor = ruta.split(".").reduce((o, k) => o[k], dict);
        if (typeof valor === "string" && valor.trim() === "") {
          vacias.push(`${locale}:${ruta}`);
        }
      }
    }
    expect(vacias).toEqual([]);
  });

  // Las formas plurales van como objeto { one, other }: si a una le falta una
  // rama, tn() devuelve undefined y se pinta "undefined" en pantalla.
  it("los plurales tienen 'one' y 'other' en ambos idiomas", () => {
    const incompletos = [];
    for (const [locale, dict] of [["es", es], ["en", en]]) {
      const visitar = (obj, prefijo = "") => {
        for (const [clave, valor] of Object.entries(obj)) {
          const ruta = prefijo ? `${prefijo}.${clave}` : clave;
          if (!valor || typeof valor !== "object") continue;
          const claves = Object.keys(valor);
          if (claves.includes("one") || claves.includes("other")) {
            if (!claves.includes("one") || !claves.includes("other")) {
              incompletos.push(`${locale}:${ruta}`);
            }
          } else {
            visitar(valor, ruta);
          }
        }
      };
      visitar(dict);
    }
    expect(incompletos).toEqual([]);
  });

  // ── La otra mitad del problema ─────────────────────────────────────────────
  // Los tests de arriba comprueban que los dos locales digan LO MISMO. Ninguno
  // comprobaba que el CÓDIGO pida cosas que existan, y por ese hueco se colaron
  // `prensa.fajaLider`, `prensa.fajaEmpate` y `prensa.fajaDistancia`: se borraron
  // de los locales al retirar la faja de clasificación de la portada, pero
  // RankParte siguió llamándolas. Como `t()` devuelve la clave cuando falta, todo
  // jugador logueado con puesto tenía un literal «prensa.fajaDistancia.one»
  // impreso en su pantalla de fin de partida. Pasaba build, lint y estos tests.
  //
  // Solo se miran las llamadas con clave LITERAL, `t("a.b")` / `tn("a.b", …)`.
  // Las claves construidas (`t(algo ? "x" : "y")`, plantillas) quedan fuera: no
  // se pueden resolver sin ejecutar, y preferimos un gate que no dé falsos
  // positivos a uno que la gente aprenda a ignorar.
  it("toda clave usada en el código existe en los dos idiomas", () => {
    const SRC = join(process.cwd(), "src");
    const ficheros = [];
    const recorrer = (dir) => {
      for (const entrada of readdirSync(dir)) {
        const full = join(dir, entrada);
        if (statSync(full).isDirectory()) recorrer(full);
        else if (/\.(jsx|js)$/.test(full) && !/\.test\.js$/.test(full)) ficheros.push(full);
      }
    };
    recorrer(SRC);

    const existe = (dict, ruta) => {
      const valor = ruta.split(".").reduce((o, k) => (o == null ? undefined : o[k]), dict);
      // Un plural es un objeto { one, other }: cuenta como existente.
      return typeof valor === "string" || (valor && typeof valor === "object");
    };

    const ausentes = [];
    for (const fichero of ficheros) {
      const src = readFileSync(fichero, "utf8");
      for (const m of src.matchAll(/\bt(?:n)?\(\s*"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g)) {
        const clave = m[1];
        const faltaEn = [];
        if (!existe(es, clave)) faltaEn.push("es");
        if (!existe(en, clave)) faltaEn.push("en");
        if (faltaEn.length) {
          const rel = fichero.slice(fichero.indexOf("src")).split("\\").join("/");
          ausentes.push(`${clave} (${faltaEn.join("+")}) ← ${rel}`);
        }
      }
    }
    expect([...new Set(ausentes)]).toEqual([]);
  });
});
