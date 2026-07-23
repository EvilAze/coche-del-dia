import { describe, it, expect } from "vitest";
import {
  meritsOf,
  collectCovers,
  sortCovers,
  groupByBrand,
  pickNewCovers,
  readSeen,
  issueLabel,
  formatWonAt,
  rarityTier,
  formatRarityPct,
  SEEN_KEY,
} from "./archive";

// localStorage de mentira: mismo contrato (getItem/setItem) para poder testear
// la memoria de "portadas nuevas" sin jsdom.
function fakeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    _dump: () => Object.fromEntries(map),
  };
}

const cover = (over = {}) => ({
  id: "a",
  marca: "Ferrari",
  modelo: "Testarossa",
  anio: 1984,
  unlocked: true,
  ...over,
});

describe("meritsOf", () => {
  it("sin sellos en una victoria normal", () => {
    expect(meritsOf(cover({ attempts: 3 }))).toEqual([]);
  });

  it("pleno al ganar al primer intento", () => {
    expect(meritsOf(cover({ attempts: 1 }))).toEqual(["pleno"]);
  });

  it("vet y pleno pueden coexistir, con vet primero", () => {
    expect(meritsOf(cover({ attempts: 1, wonAsVeteran: true }))).toEqual([
      "vet",
      "pleno",
    ]);
  });

  it("un cromo bloqueado nunca tiene sellos", () => {
    expect(meritsOf({ unlocked: false, wonAsVeteran: true })).toEqual([]);
    expect(meritsOf(null)).toEqual([]);
  });
});

describe("collectCovers", () => {
  it("aplana solo las desbloqueadas y anota el país", () => {
    const out = collectCovers([
      { pais: "Italia", cars: [cover({ id: "1" }), { id: "2", unlocked: false }] },
      { pais: "Alemania", cars: [cover({ id: "3" })] },
    ]);
    expect(out.map((c) => c.id)).toEqual(["1", "3"]);
    expect(out[0].pais).toBe("Italia");
    expect(out[1].pais).toBe("Alemania");
  });

  it("tolera payload vacío o mal formado", () => {
    expect(collectCovers(null)).toEqual([]);
    expect(collectCovers([{ pais: "X" }])).toEqual([]);
  });
});

describe("sortCovers", () => {
  it("recencia: lo último conseguido va primero", () => {
    const list = [
      cover({ id: "vieja", wonAt: "2026-01-05" }),
      cover({ id: "nueva", wonAt: "2026-07-20" }),
      cover({ id: "media", wonAt: "2026-03-11" }),
    ];
    expect(sortCovers(list).map((c) => c.id)).toEqual(["nueva", "media", "vieja"]);
  });

  it("empate de fecha: desempata por nº de edición descendente", () => {
    const list = [
      cover({ id: "e10", wonAt: "2026-07-20", issue: 10 }),
      cover({ id: "e99", wonAt: "2026-07-20", issue: 99 }),
    ];
    expect(sortCovers(list).map((c) => c.id)).toEqual(["e99", "e10"]);
  });

  it("las portadas sin fecha caen al final, no rompen el orden", () => {
    const list = [
      cover({ id: "sin" }),
      cover({ id: "con", wonAt: "2026-02-02" }),
    ];
    expect(sortCovers(list).map((c) => c.id)).toEqual(["con", "sin"]);
  });

  it("orden por año ascendente", () => {
    const list = [
      cover({ id: "moderno", anio: 2005 }),
      cover({ id: "clasico", anio: 1968 }),
    ];
    expect(sortCovers(list, "year").map((c) => c.id)).toEqual([
      "clasico",
      "moderno",
    ]);
  });

  it("no muta el array original", () => {
    const list = [cover({ id: "a", wonAt: "2026-01-01" }), cover({ id: "b", wonAt: "2026-05-01" })];
    sortCovers(list);
    expect(list.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("rarityTier", () => {
  it("tirada amplia a partir del 50 %", () => {
    expect(rarityTier(50)).toBe("wide");
    expect(rarityTier(87.4)).toBe("wide");
    expect(rarityTier(100)).toBe("wide");
  });

  it("tirada corta entre el 15 % y el 50 %", () => {
    expect(rarityTier(15)).toBe("short");
    expect(rarityTier(49.9)).toBe("short");
  });

  it("número agotado por debajo del 15 %", () => {
    expect(rarityTier(14.9)).toBe("soldout");
    expect(rarityTier(0)).toBe("soldout");
  });

  it("null sin dato", () => {
    expect(rarityTier(null)).toBe(null);
    expect(rarityTier(undefined)).toBe(null);
    expect(rarityTier(-1)).toBe(null);
  });
});

describe("formatRarityPct", () => {
  it("redondea a entero", () => {
    expect(formatRarityPct(12.4)).toBe("12");
    expect(formatRarityPct(12.6)).toBe("13");
  });

  // Redondear 0.4 % daría «0 %», que se lee como "no la tiene nadie" justo en
  // la portada más exclusiva que puedes tener.
  it("por debajo del 1 % escribe <1 en vez de 0", () => {
    expect(formatRarityPct(0.4)).toBe("<1");
    expect(formatRarityPct(0.9)).toBe("<1");
  });

  it("el 0 real sigue siendo 0", () => {
    expect(formatRarityPct(0)).toBe("0");
  });

  it("null sin dato", () => {
    expect(formatRarityPct(null)).toBe(null);
    expect(formatRarityPct("12")).toBe(null);
  });
});

describe("sortCovers por rareza", () => {
  it("lo más escaso primero", () => {
    const list = [
      cover({ id: "comun", rarity: { pct: 80 } }),
      cover({ id: "joya", rarity: { pct: 3 } }),
      cover({ id: "media", rarity: { pct: 40 } }),
    ];
    expect(sortCovers(list, "rarity").map((c) => c.id)).toEqual([
      "joya",
      "media",
      "comun",
    ]);
  });

  it("las portadas sin dato de rareza caen al final", () => {
    const list = [
      cover({ id: "sin" }),
      cover({ id: "con", rarity: { pct: 90 } }),
    ];
    expect(sortCovers(list, "rarity").map((c) => c.id)).toEqual(["con", "sin"]);
  });

  it("un orden desconocido cae a recencia en vez de romper", () => {
    const list = [
      cover({ id: "vieja", wonAt: "2026-01-01" }),
      cover({ id: "nueva", wonAt: "2026-06-01" }),
    ];
    expect(sortCovers(list, "inventado").map((c) => c.id)).toEqual([
      "nueva",
      "vieja",
    ]);
  });
});

describe("groupByBrand", () => {
  it("agrupa, cuenta y ordena por progreso", () => {
    const out = groupByBrand([
      { marca: "Lancia", unlocked: false },
      { marca: "Ferrari", unlocked: true },
      { marca: "Ferrari", unlocked: true },
      { marca: "Ferrari", unlocked: false },
    ]);
    expect(out.map((b) => b.marca)).toEqual(["Ferrari", "Lancia"]);
    expect(out[0]).toMatchObject({ unlocked: 2, total: 3 });
    expect(out[1]).toMatchObject({ unlocked: 0, total: 1 });
  });

  it("empate de progreso: alfabético", () => {
    const out = groupByBrand([{ marca: "Seat" }, { marca: "Alfa Romeo" }]);
    expect(out.map((b) => b.marca)).toEqual(["Alfa Romeo", "Seat"]);
  });
});

describe("pickNewCovers", () => {
  it("primera visita: nada es nuevo, pero todo queda sellado como visto", () => {
    const ls = fakeStorage();
    expect(pickNewCovers(["a", "b"], ls).size).toBe(0);
    expect(readSeen(ls)).toEqual(["a", "b"]);
  });

  it("segunda visita: solo lo ganado desde entonces", () => {
    const ls = fakeStorage({ [SEEN_KEY]: JSON.stringify(["a"]) });
    const fresh = pickNewCovers(["a", "b", "c"], ls);
    expect([...fresh].sort()).toEqual(["b", "c"]);
  });

  it("la cinta dura una sola visita", () => {
    const ls = fakeStorage({ [SEEN_KEY]: JSON.stringify(["a"]) });
    pickNewCovers(["a", "b"], ls);
    expect(pickNewCovers(["a", "b"], ls).size).toBe(0);
  });

  it("conserva vistos que ya no llegan en el payload", () => {
    const ls = fakeStorage({ [SEEN_KEY]: JSON.stringify(["viejo"]) });
    pickNewCovers(["nuevo"], ls);
    expect(readSeen(ls)).toEqual(["viejo", "nuevo"]);
  });

  it("un localStorage que lanza no rompe nada", () => {
    const hostil = {
      getItem: () => {
        throw new Error("denegado");
      },
      setItem: () => {
        throw new Error("denegado");
      },
    };
    expect(() => pickNewCovers(["a"], hostil)).not.toThrow();
    expect(pickNewCovers(["a"], hostil).size).toBe(0);
  });

  it("ignora un valor corrupto en localStorage", () => {
    const ls = fakeStorage({ [SEEN_KEY]: "{no-json" });
    expect(pickNewCovers(["a"], ls).size).toBe(0);
  });
});

describe("issueLabel", () => {
  it("rellena a tres cifras", () => {
    expect(issueLabel(7)).toBe("007");
    expect(issueLabel(128)).toBe("128");
    expect(issueLabel(1024)).toBe("1024");
  });

  it("placeholder cuando no hay edición", () => {
    expect(issueLabel(null)).toBe("———");
    expect(issueLabel(0)).toBe("———");
    expect(issueLabel(undefined)).toBe("———");
  });
});

describe("formatWonAt", () => {
  it("formatea una fecha ISO corta", () => {
    // No fijamos el literal exacto (depende del ICU del runtime): basta con
    // que aparezcan día y año y que no reviente.
    const out = formatWonAt("2026-07-12", "es-ES");
    expect(out).toMatch(/12/);
    expect(out).toMatch(/2026/);
  });

  it("no aplica desfase de zona horaria (el día no se mueve)", () => {
    expect(formatWonAt("2026-01-01", "en-US")).toMatch(/1/);
    expect(formatWonAt("2026-01-01", "en-US")).toMatch(/2026/);
    expect(formatWonAt("2026-01-01", "en-US")).not.toMatch(/2025/);
  });

  it("null si la fecha falta o es inválida", () => {
    expect(formatWonAt(null)).toBe(null);
    expect(formatWonAt("")).toBe(null);
    expect(formatWonAt("no-es-fecha")).toBe(null);
  });
});
