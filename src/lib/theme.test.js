// src/lib/theme.test.js
import { describe, it, expect } from "vitest";
import { resolveTheme, nextTheme } from "./theme";

describe("resolveTheme", () => {
  it("respeta el override manual 'noche' aunque el sistema sea claro", () => {
    expect(resolveTheme("noche", false)).toBe("noche");
  });
  it("respeta el override manual 'dia' aunque el sistema sea oscuro", () => {
    expect(resolveTheme("dia", true)).toBe("dia");
  });
  it("sin override, sigue al sistema oscuro", () => {
    expect(resolveTheme(null, true)).toBe("noche");
  });
  it("sin override, sigue al sistema claro", () => {
    expect(resolveTheme(null, false)).toBe("dia");
  });
  it("valor basura en storage → cae al sistema", () => {
    expect(resolveTheme("xyz", true)).toBe("noche");
  });
});

describe("nextTheme", () => {
  it("dia → noche", () => expect(nextTheme("dia")).toBe("noche"));
  it("noche → dia", () => expect(nextTheme("noche")).toBe("dia"));
});
