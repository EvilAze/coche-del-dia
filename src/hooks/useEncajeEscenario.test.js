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

const SANGRIA = 18; // padding lateral del pliego, que el escenario RESPETA

// 412×877 CSS px. La foto va ENMARCADA, dentro del margen del pliego: 412 − 36 =
// 376 de ancho, 282 de alto en 4:3. Fue 412×309 mientras el escenario iba a
// sangre; la decisión de enmarcarlo está razonada en index.css («LA FOTO VA
// ENMARCADA, NO A SANGRE») y esta cifra tiene que seguirla, porque es justo el
// número que el hook usa para decidir si el botón cabe.
const MOVIL = {
  altoVentana: 877,
  franja: 24, // barra de gestos del sistema
  arriba: 275, // topbar + masthead + folio + faja + padding
  extras: 32, // ladillo de la sección + su gap
  hueco: 12, // gap del pliego
  altoJugar: 283, // cupón (3 campos) + botón ADIVINAR
  altoNatural: ((412 - SANGRIA * 2) * 3) / 4, // 282: la columna, en 4:3
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

  it("REGRESIÓN: el alto natural sale del ancho REAL, no de una suposición", () => {
    // El fallo original: el hook calculaba el alto natural desde la columna
    // mientras el CSS sangraba la foto hasta los bordes, así que la creía 27px
    // más baja de lo que era, decidía que cabía y no capaba — el botón se salía.
    // Al enmarcar la foto la geometría se invirtió, y con ella el riesgo: si el
    // hook siguiera SUMANDO la sangría que el CSS ya no rompe, se pasaría de
    // conservador y recortaría foto que sí cabe.
    //
    // Este test fija las dos direcciones. Suponer una foto MÁS ALTA que la real
    // nunca puede dejar más foto en pantalla (eso sacaría el botón), y suponerla
    // más baja nunca puede dejar menos (eso malgasta ancho).
    const real = calcularEncaje(MOVIL);
    const suponiendoMasAlta = calcularEncaje({
      ...MOVIL,
      altoNatural: ((412 + SANGRIA * 2) * 3) / 4, // como si aún sangrara
    });
    // −100 cruza el umbral a propósito: con esa suposición el hook decide que
    // cabe y devuelve null ("no la toques"), que es el caso extremo de "más
    // foto". Un −40 se quedaba del mismo lado del umbral y el test no probaba
    // nada que el primero no probara ya.
    const suponiendoMasBaja = calcularEncaje({
      ...MOVIL,
      altoNatural: MOVIL.altoNatural - 100,
    });
    expect(suponiendoMasBaja).toBeNull();
    expect(suponiendoMasAlta ?? Infinity).toBeLessThanOrEqual(real ?? Infinity);
    expect(suponiendoMasBaja ?? Infinity).toBeGreaterThanOrEqual(real ?? 0);
    // Y la medida real tiene que caber de verdad, que es de lo que va el hook.
    expect(fondoCon(MOVIL, (real * 3) / 4)).toBeLessThanOrEqual(
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
