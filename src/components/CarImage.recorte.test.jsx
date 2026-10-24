// @vitest-environment jsdom
// src/components/CarImage.recorte.test.jsx
// EL CAMBIO DE RECORTE ENTRE INTENTOS. Desde oct-2026 el servidor sirve el
// recorte de CADA intento (api/_lib/edge/image-ticket.js) y no uno solo que el
// CSS cierre, así que al fallar llega un `src` nuevo. Lo que este test vigila:
//   1. la foto vieja sigue pintada mientras la nueva se precarga (ni esqueleto
//      ni hueco entre intento e intento);
//   2. la nueva entra calcando el encuadre anterior (escala > 1, sin
//      transición) y después se suelta hasta 1 con la transición de la lente;
//   3. la escala nunca baja de 1, que dejaría ver el borde de un recorte más
//      pequeño que el marco.

import React from "react"; // eslint-disable-line no-unused-vars
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, fireEvent, act } from "@testing-library/react";
import CarImage from "./CarImage";

afterEach(cleanup);

// Escalas de cssZoomLevels para el intento 1 y 2 (las mismas para todo coche).
const L1 = 2.176;
const L2 = 1.792;
const SRC1 = "/api/daily-image?d=2026-10-25&v=abc&z=1";
const SRC2 = "/api/daily-image?d=2026-10-25&v=abc&z=2&k=AAAAAAAAAAAAAAAAAAAAAA";

const props = (over) => ({
  configurator: true,
  status: "playing",
  hintIndex: 0,
  totalHints: 5,
  ...over,
});

const imgs = (container) => [...container.querySelectorAll("img")];
const pintada = (container) => imgs(container).find((i) => !i.dataset.src);
const precarga = (container) => imgs(container).find((i) => i.dataset.src);
const escalaDe = (img) => Number(/scale\(([\d.]+)\)/.exec(img.style.transform)?.[1]);

const frames = () =>
  act(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))))
  );

describe("CarImage con recorte por intento", () => {
  it("en el intento en curso pinta su recorte a escala 1", () => {
    const { container } = render(<CarImage {...props({ src: SRC1, zoom: L1, escalaRecorte: L1 })} />);
    expect(pintada(container).getAttribute("src")).toContain("&z=1");
    expect(escalaDe(pintada(container))).toBe(1);
  });

  it("al fallar, precarga el recorte nuevo sin soltar el viejo y luego lo abre", async () => {
    const { container, rerender } = render(
      <CarImage {...props({ src: SRC1, zoom: L1, escalaRecorte: L1 })} />
    );
    fireEvent.load(pintada(container));

    // Llega el fallo: zoom e src nuevos en el mismo render (useGame los fija
    // en el mismo lote).
    rerender(<CarImage {...props({ src: SRC2, zoom: L2, escalaRecorte: L2, hintIndex: 1 })} />);

    // 1. La foto pintada sigue siendo la del intento 1, entera (escala 1, no
    //    L2/L1 < 1), y el recorte 2 se está bajando aparte.
    expect(pintada(container).getAttribute("src")).toContain("&z=1");
    expect(escalaDe(pintada(container))).toBe(1);
    expect(precarga(container).getAttribute("src")).toContain("&z=2");
    expect(pintada(container).style.opacity).toBe("1");

    // 2. Termina de cargar: entra calcando el encuadre anterior, sin transición
    //    de transform.
    await act(async () => {
      fireEvent.load(precarga(container));
    });
    expect(precarga(container)).toBeUndefined();
    expect(pintada(container).getAttribute("src")).toContain("&z=2");
    expect(escalaDe(pintada(container))).toBeCloseTo(L1 / L2, 3);
    expect(pintada(container).style.transition).not.toContain("transform");
    expect(pintada(container).style.opacity).toBe("1");

    // …y dos frames después se suelta hasta 1 con la lente.
    await frames();
    expect(escalaDe(pintada(container))).toBe(1);
    expect(pintada(container).style.transition).toContain("transform");
  });

  it("al revelar vuelve al camino de siempre (foto entera, sin precarga)", () => {
    const { container, rerender } = render(
      <CarImage {...props({ src: SRC1, zoom: L1, escalaRecorte: L1 })} />
    );
    fireEvent.load(pintada(container));
    rerender(
      <CarImage {...props({ src: "/api/daily-image?d=2026-10-25&v=abc&t=tok", zoom: 1, escalaRecorte: null, status: "won" })} />
    );
    expect(precarga(container)).toBeUndefined();
    expect(pintada(container).getAttribute("src")).toContain("&t=tok");
  });

  it("sin escalaRecorte (repesca, admin) escala con zoom como siempre", () => {
    const { container } = render(<CarImage {...props({ src: "/api/repesca/image?x=1", zoom: 1.8 })} />);
    expect(escalaDe(pintada(container))).toBe(1.8);
  });
});
