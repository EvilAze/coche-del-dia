// api/_lib/season-theme.test.js
// Tests de la validación del filtro temático. El foco está en los casos que
// romperían la PROMESA de la temporada sin que nadie se entere: una clave mal
// escrita, una lista vacía o un rango de años invertido no deben acabar en un
// filtro que sortea entre todo el catálogo mientras el banner anuncia un tema.

import { describe, it, expect } from "vitest";
import {
  normalizeThemeFilter,
  normalizeCarTags,
  MAX_LIST_VALUES,
  MIN_YEAR,
  MAX_YEAR,
} from "./season-theme.js";

describe("normalizeThemeFilter — sin temática", () => {
  it("acepta null/undefined/'' como 'sin filtro'", () => {
    for (const input of [null, undefined, ""]) {
      expect(normalizeThemeFilter(input)).toEqual({ value: null, error: null });
    }
  });

  it("colapsa un objeto vacío a null (una sola representación canónica)", () => {
    expect(normalizeThemeFilter({})).toEqual({ value: null, error: null });
  });

  it("colapsa listas que quedan vacías tras limpiar", () => {
    const { value, error } = normalizeThemeFilter({ tags: ["", "   "] });
    expect(error).toBeNull();
    expect(value).toBeNull();
  });

  it("rechaza tipos que no son objeto", () => {
    for (const input of [42, "grupo-b", true, ["grupo-b"]]) {
      expect(normalizeThemeFilter(input).error).toBeTruthy();
    }
  });
});

describe("normalizeThemeFilter — claves", () => {
  it("rechaza claves desconocidas en vez de ignorarlas", () => {
    // El fallo que esto previene: `tag` en singular pasaría desapercibido y
    // la temporada sortearía entre TODO el catálogo anunciando un tema.
    const { value, error } = normalizeThemeFilter({ tag: ["grupo-b"] });
    expect(value).toBeNull();
    expect(error).toContain("tag");
  });

  it("nombra todas las claves inválidas de golpe", () => {
    const { error } = normalizeThemeFilter({ marca: ["Seat"], anio: 1990 });
    expect(error).toContain("marca");
    expect(error).toContain("anio");
  });
});

describe("normalizeThemeFilter — listas", () => {
  it("recorta, descarta vacíos y conserva el orden", () => {
    const { value } = normalizeThemeFilter({ pais: [" Italia ", "", "Francia"] });
    expect(value).toEqual({ pais: ["Italia", "Francia"] });
  });

  it("deduplica sin distinguir mayúsculas", () => {
    const { value } = normalizeThemeFilter({ pais: ["Italia", "italia", "ITALIA"] });
    expect(value).toEqual({ pais: ["Italia"] });
  });

  it("baja las etiquetas a minúsculas (son slugs internos)", () => {
    const { value } = normalizeThemeFilter({ tags: ["Grupo-B", "RALLY"] });
    expect(value).toEqual({ tags: ["grupo-b", "rally"] });
  });

  it("convierte espacios en guiones al slugificar etiquetas", () => {
    const { value } = normalizeThemeFilter({ tags: ["Grupo B"] });
    expect(value).toEqual({ tags: ["grupo-b"] });
  });

  it("preserva mayúsculas en pais/make (son valores de display)", () => {
    const { value } = normalizeThemeFilter({ make: ["Ferrari"], pais: ["Italia"] });
    expect(value).toEqual({ make: ["Ferrari"], pais: ["Italia"] });
  });

  it("rechaza listas con elementos que no son texto", () => {
    expect(normalizeThemeFilter({ tags: ["ok", 7] }).error).toBeTruthy();
  });

  it("rechaza un valor de lista que no es array", () => {
    expect(normalizeThemeFilter({ tags: "grupo-b" }).error).toBeTruthy();
  });

  it("rechaza listas por encima del tope", () => {
    const tags = Array.from({ length: MAX_LIST_VALUES + 1 }, (_, i) => `t${i}`);
    expect(normalizeThemeFilter({ tags }).error).toBeTruthy();
  });
});

describe("normalizeThemeFilter — años", () => {
  it("acepta números y strings numéricas (el input del panel manda string)", () => {
    expect(normalizeThemeFilter({ year_from: 1980 }).value).toEqual({ year_from: 1980 });
    expect(normalizeThemeFilter({ year_from: "1980" }).value).toEqual({ year_from: 1980 });
  });

  it("rechaza años fuera de rango y no enteros", () => {
    for (const y of [MIN_YEAR - 1, MAX_YEAR + 1, 1980.5, "mil", NaN]) {
      expect(normalizeThemeFilter({ year_from: y }).error).toBeTruthy();
    }
  });

  it("ignora el año ausente o vacío", () => {
    const { value, error } = normalizeThemeFilter({ year_from: "", year_to: null });
    expect(error).toBeNull();
    expect(value).toBeNull();
  });

  it("rechaza un rango invertido", () => {
    const { error } = normalizeThemeFilter({ year_from: 1990, year_to: 1980 });
    expect(error).toBeTruthy();
  });

  it("acepta un rango de un solo año", () => {
    const { value } = normalizeThemeFilter({ year_from: 1986, year_to: 1986 });
    expect(value).toEqual({ year_from: 1986, year_to: 1986 });
  });
});

describe("normalizeCarTags — etiquetas de un coche", () => {
  it("null/undefined = 'no tocar la columna'", () => {
    expect(normalizeCarTags(null)).toEqual({ value: null, error: null });
    expect(normalizeCarTags(undefined)).toEqual({ value: null, error: null });
  });

  it("lista vacía SÍ es significativa: quitar todas las etiquetas", () => {
    expect(normalizeCarTags([])).toEqual({ value: [], error: null });
  });

  it("aplica el MISMO slug que el filtro (si no, el tema no casaría)", () => {
    // Este es el test que protege la feature entera: etiquetar "Grupo B" en el
    // coche y filtrar por "grupo-b" en la temporada tiene que converger.
    const car = normalizeCarTags(["Grupo B"]).value;
    const filter = normalizeThemeFilter({ tags: ["grupo-b"] }).value;
    expect(car).toEqual(filter.tags);
  });

  it("deduplica y descarta vacíos", () => {
    expect(normalizeCarTags(["rally", "  ", "RALLY", "grupo-b"]).value).toEqual([
      "rally",
      "grupo-b",
    ]);
  });

  it("rechaza no-listas, elementos no-texto y exceso de etiquetas", () => {
    expect(normalizeCarTags("rally").error).toBeTruthy();
    expect(normalizeCarTags([1, 2]).error).toBeTruthy();
    expect(
      normalizeCarTags(Array.from({ length: MAX_LIST_VALUES + 1 }, (_, i) => `t${i}`)).error
    ).toBeTruthy();
  });
});

describe("normalizeThemeFilter — combinaciones reales", () => {
  it("«Grupo B» (curado por etiqueta)", () => {
    const { value } = normalizeThemeFilter({ tags: ["grupo-b"] });
    expect(value).toEqual({ tags: ["grupo-b"] });
  });

  it("«Los 80 italianos» (declarativo, sin etiquetar nada)", () => {
    const { value } = normalizeThemeFilter({
      pais: ["Italia"],
      year_from: 1980,
      year_to: 1989,
    });
    expect(value).toEqual({ pais: ["Italia"], year_from: 1980, year_to: 1989 });
  });

  it("un error en cualquier clave anula el filtro entero", () => {
    // No queremos guardados a medias: o el filtro es correcto del todo, o no
    // se escribe. Un filtro parcial sería una temática mentirosa.
    const { value, error } = normalizeThemeFilter({
      pais: ["Italia"],
      year_from: 3000,
    });
    expect(value).toBeNull();
    expect(error).toBeTruthy();
  });
});
