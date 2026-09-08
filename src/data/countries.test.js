// src/data/countries.test.js
// LAS DOS MITADES DE UN PAÍS TIENEN QUE VIAJAR JUNTAS.
//
// Un país entra en el juego desde el panel de administración (la columna `pais`
// de un coche), y por aquí necesita DOS cosas que viven en el repositorio: su
// código ISO en `COUNTRY_CODES` —de donde sale el nombre traducido— y su JPG en
// `public/flags/`. Nada obliga a que se añadan a la vez: sin código, el jugador
// inglés lee el país en español; sin bandera, ve el icono de imagen rota
// justamente en la apostilla que le dice «mismo país», que es una PISTA.
//
// Este test no puede saber qué países hay en la base de datos —es remota, y el
// catálogo cambia sin tocar el repositorio—, pero sí puede exigir que las dos
// mitades locales estén sincronizadas: todo país con código tiene su bandera y
// al revés. Pasó con «Isla de Man» (la Peel P50): el coche entró en el catálogo
// y aquí no había ni código ni bandera.

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { COUNTRY_CODES, flagImagePath } from "./countries";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BANDERAS = join(RAIZ, "public", "flags");

describe("países", () => {
  it("cada país con código tiene su bandera en public/flags", () => {
    const sinBandera = Object.keys(COUNTRY_CODES).filter(
      (pais) => !existsSync(join(RAIZ, "public", flagImagePath(pais)))
    );
    expect(sinBandera).toEqual([]);
  });

  it("cada bandera de public/flags corresponde a un país con código", () => {
    const conCodigo = new Set(
      Object.keys(COUNTRY_CODES).map((p) => flagImagePath(p).split("/").pop())
    );
    const huerfanas = readdirSync(BANDERAS)
      .filter((f) => f.endsWith(".jpg"))
      .filter((f) => !conCodigo.has(f));
    expect(huerfanas).toEqual([]);
  });

  it("los códigos son ISO 3166-1 alfa-2 y los reconoce Intl", () => {
    for (const [pais, code] of Object.entries(COUNTRY_CODES)) {
      expect(code, pais).toMatch(/^[A-Z]{2}$/);
      const nombre = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
      // `of()` devuelve el propio código cuando no conoce la región.
      expect(nombre, `${pais} (${code})`).not.toBe(code);
    }
  });
});
