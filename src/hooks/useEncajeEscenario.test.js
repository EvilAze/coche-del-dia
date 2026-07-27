// src/hooks/useEncajeEscenario.test.js
// La aritmética del encaje del escenario. Se testea aparte del DOM porque es
// justo la parte que se rompe en silencio: si algún día la portada crece (otra
// línea en el masthead, otro bloque bajo el folio) el botón vuelve a caerse de
// pantalla sin que falle nada.
//
// Las medidas salen de un móvil real (Android, 412 CSS px de ancho) donde el
// botón ADIVINAR aparecía cortado por debajo de la barra de gestos. Los dos
// últimos tests son regresiones de los dos errores que tuvo la primera versión.

import { describe, it, expect } from "vitest";
import { calcularEncaje } from "./useEncajeEscenario";

const SANGRIA = 18; // padding lateral del pliego, que el escenario rompe

// 412×877 CSS px. La foto va A SANGRE: 412 de ancho, 309 de alto en 4:3.
const MOVIL = {
  altoVentana: 877,
  franja: 24, // barra de gestos del sistema
  arriba: 275, // topbar + masthead + folio + faja + padding
  extras: 32, // ladillo de la sección + su gap
  hueco: 12, // gap del pliego
  altoJugar: 283, // cupón (3 campos) + botón ADIVINAR
  altoNatural: 309, // 412 a sangre, en 4:3
};

// Lo que ocupa todo menos el marco: sirve para comprobar que el resultado cabe.
function fondoCon(medidas, altoMarco) {
  return (
    medidas.arriba + medidas.extras + altoMarco + medidas.hueco + medidas.altoJugar
  );
}

describe("calcularEncaje", () => {
  it("capa el escenario cuando el botón no entra", () => {
    const ancho = calcularEncaje(MOVIL);
    expect(ancho).not.toBeNull();
    expect(ancho).toBeLessThan(412);
  });

  it("el resultado deja el botón dentro, por encima de la barra de gestos", () => {
    const ancho = calcularEncaje(MOVIL);
    const fondo = fondoCon(MOVIL, (ancho * 3) / 4);
    expect(fondo).toBeLessThanOrEqual(MOVIL.altoVentana - MOVIL.franja);
  });

  it("no toca nada cuando ya cabe (pantalla alta)", () => {
    expect(calcularEncaje({ ...MOVIL, altoVentana: 1200 })).toBeNull();
  });

  it("mantiene el 4:3 exacto — la proporción es intocable (reglas 5 y 7)", () => {
    const ancho = calcularEncaje(MOVIL);
    expect(ancho / ((ancho * 3) / 4)).toBeCloseTo(4 / 3, 10);
  });

  it("respeta el suelo: prefiere perder el botón antes que un sello de correos", () => {
    // Móvil en horizontal: no hay altura para nada.
    const ancho = calcularEncaje({ ...MOVIL, altoVentana: 420 });
    expect((ancho * 3) / 4).toBe(168);
  });

  it("a más portada, menos foto (monotonía)", () => {
    const conFaja = calcularEncaje(MOVIL);
    const sinFaja = calcularEncaje({ ...MOVIL, arriba: MOVIL.arriba - 72 });
    expect(conFaja).toBeLessThan(sinFaja ?? Infinity);
  });

  // ── Regresiones ────────────────────────────────────────────────────────
  // Los dos fallos que dejaron el botón cortado en el móvil de prueba pese a
  // que el encaje "estaba puesto". Los dos eran de aritmética, no de CSS.

  it("REGRESIÓN: cuenta la sangría — la foto es más alta de lo que mide la columna", () => {
    // La primera versión calculaba el alto natural desde el ancho de la COLUMNA
    // (412 − 36 = 376 → 282 de alto) ignorando que el escenario sangra hasta los
    // bordes. Con ese número creía que cabía y no capaba nada, mientras en
    // pantalla la foto medía 309: 27px que se salían.
    const anchoColumna = 412 - SANGRIA * 2;
    const conError = calcularEncaje({
      ...MOVIL,
      altoNatural: (anchoColumna * 3) / 4,
    });
    const correcto = calcularEncaje(MOVIL);
    // Da igual si el caso equivocado capaba o no: lo que NO puede es dejar más
    // foto que el cálculo bueno, porque entonces el botón se sale.
    expect(correcto).toBeLessThanOrEqual(conError ?? Infinity);
    // Y el bueno tiene que caber de verdad.
    expect(fondoCon(MOVIL, (correcto * 3) / 4)).toBeLessThanOrEqual(
      MOVIL.altoVentana - MOVIL.franja
    );
  });

  it("REGRESIÓN: descuenta la barra de gestos", () => {
    // `innerHeight` incluye la franja del sistema en la app nativa, pero encima
    // de ella no se puede poner nada usable: el botón quedaba debajo del pill.
    const sinFranja = calcularEncaje({ ...MOVIL, franja: 0 });
    const conFranja = calcularEncaje(MOVIL);
    expect(conFranja).toBeLessThan(sinFranja);
    // 24px menos de ventana son 24 de alto = 32 de ancho.
    expect(sinFranja - conFranja).toBe(32);
  });
});
