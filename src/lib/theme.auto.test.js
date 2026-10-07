// @vitest-environment jsdom
//
// src/lib/theme.auto.test.js
// «AUTO» SIGUE AL SISTEMA SIN QUEDARSE PEGADO.
//
// El oyente de prefers-color-scheme llamaba a setTheme(), que guarda en
// localStorage: el primer cambio del sistema (el oscuro automático al
// anochecer) quedaba grabado como elección manual y «Auto» dejaba de seguir al
// sistema para siempre. Medido en producción el 7-oct-2026.
import { describe, it, expect, vi, beforeEach } from "vitest";

let alCambiar = null;

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  alCambiar = null;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: (_tipo, fn) => {
      alCambiar = fn;
    },
    removeEventListener() {},
  });
});

describe("modo Auto", () => {
  it("un cambio del sistema repinta el tema pero no lo guarda", async () => {
    await import("./theme.js");
    expect(typeof alCambiar).toBe("function");

    alCambiar({ matches: true });
    expect(document.documentElement.dataset.tema).toBe("noche");
    expect(localStorage.getItem("cdd-tema")).toBeNull();

    alCambiar({ matches: false });
    expect(document.documentElement.dataset.tema).toBe("dia");
    expect(localStorage.getItem("cdd-tema")).toBeNull();
  });

  it("con una elección manual guardada, el sistema no manda", async () => {
    localStorage.setItem("cdd-tema", "dia");
    await import("./theme.js");
    document.documentElement.dataset.tema = "dia";
    alCambiar({ matches: true });
    expect(document.documentElement.dataset.tema).toBe("dia");
    expect(localStorage.getItem("cdd-tema")).toBe("dia");
  });
});
