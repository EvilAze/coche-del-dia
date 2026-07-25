// src/i18n/resolveLocale.test.js
import { describe, it, expect } from "vitest";
import { resolveLocale, normalizaLocale } from "./resolveLocale";

const SOPORTADOS = ["es", "en"];
const FALLBACK = "es";

// Azúcar: rellena las señales que no importan en cada caso.
const r = (señales) =>
  resolveLocale(
    { nativo: "", override: null, sello: null, navegador: "", ...señales },
    SOPORTADOS,
    FALLBACK
  );

describe("normalizaLocale", () => {
  it("se queda con el código primario", () => {
    expect(normalizaLocale("en-GB")).toBe("en");
    expect(normalizaLocale("ES")).toBe("es");
  });
  it("aguanta basura", () => {
    for (const v of [null, undefined, 42, {}]) expect(normalizaLocale(v)).toBe("");
  });
});

describe("resolveLocale — sin override de la app", () => {
  it("web (sin nativo) sigue al navegador", () => {
    expect(r({ navegador: "en-US" })).toBe("en");
  });

  it("navegador no soportado → fallback", () => {
    expect(r({ navegador: "de-DE" })).toBe("es");
  });

  it("el idioma por app de Android manda sobre el navegador", () => {
    // Móvil del sistema en español, pero la app puesta en inglés por app.
    expect(r({ nativo: "en", navegador: "es-ES" })).toBe("en");
  });

  it("un idioma por app que no hablamos se ignora", () => {
    expect(r({ nativo: "fr", navegador: "en-US" })).toBe("en");
  });
});

describe("resolveLocale — con override de la app", () => {
  it("el override manda mientras Android no cambie", () => {
    // Eligió "es" dentro de la app; Android sin idioma por app (sello "").
    expect(r({ override: "es", sello: "", nativo: "" })).toBe("es");
  });

  // EL CASO QUE HUNDIÓ EL INTENTO ANTERIOR.
  // Móvil en inglés, el usuario eligió "es" dentro de la app (sello=""), y
  // LUEGO puso la app en English desde los ajustes de Android (nativo="en").
  // navigator.language nunca dejó de ser "en", así que la versión con sello de
  // navegador no lo detectaba. Con el sello NATIVO ("" ≠ "en") sí.
  it("Android elegido DESPUÉS de la elección en la app → gana Android", () => {
    expect(r({ override: "es", sello: "", nativo: "en" })).toBe("en");
  });

  it("el selector de la app funciona aunque Android tenga idioma por app", () => {
    // Android estaba en "en" cuando el usuario eligió "es" dentro de la app:
    // el sello guardó "en", el nativo sigue "en" (sin cambio) → gana "es".
    expect(r({ override: "es", sello: "en", nativo: "en" })).toBe("es");
  });

  it("override sin sello (versión antigua) manda: no podemos saber si cambió", () => {
    expect(r({ override: "en", sello: null, nativo: "es" })).toBe("en");
  });

  it("si Android cambió a un idioma que no hablamos, se respeta el override", () => {
    expect(r({ override: "en", sello: "es", nativo: "fr" })).toBe("en");
  });

  it("override inválido se ignora y se sigue resolviendo", () => {
    expect(r({ override: "klingon", sello: "es", nativo: "", navegador: "en-US" })).toBe("en");
  });
});
