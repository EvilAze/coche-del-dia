// @vitest-environment jsdom
// src/components/RepescaDrawAnimation.test.jsx
// El sorteo es una coreografía con esperas reales (el servidor elige, la foto
// llega). Lo que no puede pasar: revelar antes de tener coche, quedarse
// colgado si la foto no llega, o avisar al padre dos veces (navegaría dos).
import React from "react"; // eslint-disable-line no-unused-vars
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

vi.mock("../i18n", () => ({
  useT: () => ({
    t: (k) => k,
    tn: (k, n) => `${k}:${n}`,
    locale: "es",
  }),
}));
vi.mock("../lib/haptics", () => ({
  haptic: { trinquete: vi.fn(), impactMedium: vi.fn(), impactHeavy: vi.fn() },
}));

import RepescaDrawAnimation from "./RepescaDrawAnimation";

const fase = (c) => c.querySelector(".sorteo")?.getAttribute("data-fase");
const avanza = (ms) => act(() => vi.advanceTimersByTime(ms));

describe("RepescaDrawAnimation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("gira, enfoca y NO revela mientras el servidor no ha elegido", () => {
    const onFin = vi.fn();
    const { container } = render(<RepescaDrawAnimation onFin={onFin} pendientes={12} />);
    expect(fase(container)).toBe("abrir");
    avanza(300);
    expect(fase(container)).toBe("girar");
    avanza(5000);
    expect(fase(container)).toBe("enfocar");
    expect(onFin).not.toHaveBeenCalled();
  });

  it("con coche y foto, revela, sella y avisa UNA vez", async () => {
    const onFin = vi.fn();
    const { container, rerender } = render(<RepescaDrawAnimation onFin={onFin} />);
    avanza(2300);
    rerender(<RepescaDrawAnimation onFin={onFin} confirmado foto="blob:foto" zoomBase={3.7} />);
    // La decodificación de la foto es una promesa: que se resuelva.
    await act(async () => {});
    expect(fase(container)).toBe("revelado");
    expect(container.querySelector(".sorteo").getAttribute("data-foto")).toBe("si");
    avanza(300);
    expect(fase(container)).toBe("sello");
    avanza(2000);
    expect(onFin).toHaveBeenCalledTimes(1);
    // La foto sale con la escala del intento 1, nunca entera.
    const img = container.querySelector(".sorteo-foto img");
    expect(img.style.transform).toMatch(/^scale\((?!1\))/);
  });

  it("si la foto no llega, se revela igual pasado el tope", () => {
    const onFin = vi.fn();
    const { container, rerender } = render(<RepescaDrawAnimation onFin={onFin} />);
    avanza(2300);
    rerender(<RepescaDrawAnimation onFin={onFin} confirmado />);
    expect(fase(container)).toBe("enfocar");
    avanza(2600);
    expect(fase(container)).toBe("revelado");
    expect(container.querySelector(".sorteo").getAttribute("data-foto")).toBe("no");
    avanza(1500);
    expect(onFin).toHaveBeenCalledTimes(1);
  });
});
