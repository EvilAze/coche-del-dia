// src/lib/zoomRepesca.test.js
import { describe, it, expect } from "vitest";
import { zoomRepesca } from "./zoomRepesca";
import { cssZoomLevels } from "./zoom";

const niveles = cssZoomLevels(3.7);

describe("zoomRepesca", () => {
  it("mientras carga, ya cerrada como en el intento 1 (nunca 1.0)", () => {
    const z = zoomRepesca({ phase: "loading", veterano: false, intentos: 0, niveles });
    expect(z).toBe(niveles[0]);
    expect(z).toBeGreaterThan(1);
  });

  it("al confirmarse una partida nueva, la escala no cambia: no hay zoom que animar", () => {
    const cargando = zoomRepesca({ phase: "loading", veterano: false, intentos: 0, niveles });
    const jugando = zoomRepesca({ phase: "playing", veterano: false, intentos: 0, niveles });
    expect(jugando).toBe(cargando);
  });

  it("al retomar una partida con intentos, solo se abre (nunca se cierra)", () => {
    const cargando = zoomRepesca({ phase: "loading", veterano: false, intentos: 0, niveles });
    const jugando = zoomRepesca({ phase: "playing", veterano: false, intentos: 3, niveles });
    expect(jugando).toBe(niveles[3]);
    expect(jugando).toBeLessThan(cargando);
  });

  it("Veterano: el recorte del último intento", () => {
    expect(zoomRepesca({ phase: "playing", veterano: true, intentos: 0, niveles })).toBe(niveles[niveles.length - 1]);
  });

  it("terminada: la foto entera", () => {
    expect(zoomRepesca({ phase: "lost", veterano: false, intentos: 5, niveles })).toBe(1);
    expect(zoomRepesca({ phase: "won", veterano: false, intentos: 2, niveles })).toBe(1);
  });
});
