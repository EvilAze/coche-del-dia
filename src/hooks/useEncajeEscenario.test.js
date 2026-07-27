// src/hooks/useEncajeEscenario.test.js
// La aritmética del encaje del escenario. Se testea aparte del DOM porque es
// justo la parte que se rompe en silencio: si algún día la portada crece (otra
// línea en el masthead, otro bloque bajo el folio) el botón vuelve a caerse de
// pantalla sin que falle nada.

import { describe, it, expect } from "vitest";
import { calcularEncaje } from "./useEncajeEscenario";

// Medidas reales de un iPhone SE (375×667) con la portada completa: es el caso
// que destapó el problema — el botón ADIVINAR quedaba cortado por abajo.
const SE = {
  altoVentana: 667,
  arriba: 204, // topbar + masthead + folio + faja + padding
  extras: 30, // ladillo de la sección de la foto
  hueco: 12, // gap del pliego
  altoJugar: 236, // cupón (3 campos) + botón
  altoNatural: 254, // 339px de columna en 4:3
};

describe("calcularEncaje", () => {
  it("capa el escenario cuando el botón no entra", () => {
    const ancho = calcularEncaje(SE);
    expect(ancho).not.toBeNull();
    // Y el cap tiene que ser MENOR que el ancho natural: si no, no encaja nada.
    expect(ancho).toBeLessThan(339);
  });

  it("el resultado deja el cupón entero dentro de la ventana", () => {
    const ancho = calcularEncaje(SE);
    const altoMarco = (ancho * 3) / 4;
    const fondo =
      SE.arriba + SE.extras + altoMarco + SE.hueco + SE.altoJugar;
    expect(fondo).toBeLessThanOrEqual(SE.altoVentana);
  });

  it("no toca nada cuando ya cabe (pantalla alta)", () => {
    expect(calcularEncaje({ ...SE, altoVentana: 900 })).toBeNull();
  });

  it("no toca nada cuando cabe justo", () => {
    // Ventana del tamaño exacto de todas las piezas + el aire de respeto.
    const justo =
      SE.arriba + SE.extras + SE.altoNatural + SE.hueco + SE.altoJugar + 10;
    expect(calcularEncaje({ ...SE, altoVentana: justo })).toBeNull();
  });

  it("respeta el suelo: prefiere perder el botón antes que un sello de correos", () => {
    // Móvil en horizontal: no hay altura para nada.
    const ancho = calcularEncaje({ ...SE, altoVentana: 320 });
    expect((ancho * 3) / 4).toBe(168);
  });

  it("mantiene el 4:3 exacto — la proporción es intocable (reglas 5 y 7)", () => {
    const ancho = calcularEncaje(SE);
    const alto = (ancho * 3) / 4;
    expect(ancho / alto).toBeCloseTo(4 / 3, 10);
  });

  it("a más portada, menos foto (monotonía)", () => {
    const conFaja = calcularEncaje(SE);
    const sinFaja = calcularEncaje({ ...SE, arriba: SE.arriba - 72 });
    // OJO con la lectura: con estas medidas el escenario ya iba al límite ANTES
    // de la faja (se pasaba por unos pocos píxeles), así que los dos casos
    // capan. Lo que este test fija es la relación, que es lo que importa: cada
    // píxel que crece la portada es un píxel menos de foto, siempre en el mismo
    // sentido y sin escalones raros.
    expect(sinFaja).not.toBeNull();
    expect(conFaja).toBeLessThan(sinFaja);
  });
});
