// src/lib/escenarioApartado.test.js
// Los casos son móviles reales, con las medidas que documenta «EL PLIEGO SIN
// SCROLL» en index.css: cabecera 59px, pliego con su inset, marco 4:3 derivado
// del ancho de columna.

import { describe, it, expect } from "vitest";
import { calcularApartado, margenDeCrecimiento } from "./escenarioApartado";

describe("calcularApartado", () => {
  it("no toca nada si la foto ya cabe sobre la hoja", () => {
    // La hoja del AÑO con la horquilla acotada: cinco décadas y poco más, así
    // que sube poco y la foto se queda donde estaba. Es el caso bueno.
    expect(
      calcularApartado({ tope: 30, suelo: 450, fotoTop: 137, fotoAlto: 252 })
    ).toEqual({ subida: 0, escala: 1 });
  });

  it("sube la foto sin encogerla cuando el cromo de encima da de sí", () => {
    // 360x800: la hoja de MARCA se lleva 500px, así que el suelo queda en 290 y
    // sobran 99px. Encima de la foto hay 107px de cabecera y ladillo: se apaga
    // ese cromo, la foto sube 99 y NO encoge — que es el objetivo del diseño.
    expect(
      calcularApartado({ tope: 30, suelo: 290, fotoTop: 137, fotoAlto: 252 })
    ).toEqual({ subida: 99, escala: 1 });
  });

  it("solo encoge lo que la subida no ha podido resolver", () => {
    // Teclado abierto: la ventana encoge, la hoja se queda con su mínimo y el
    // hueco de arriba es de 148px para un marco de 252. Sube los 107 que hay y
    // el resto lo pone la escala.
    const r = calcularApartado({ tope: 30, suelo: 178, fotoTop: 137, fotoAlto: 252 });
    expect(r.subida).toBe(107);
    expect(r.escala).toBeCloseTo(148 / 252, 3);
  });

  it("nunca sube por encima del tope del pliego", () => {
    // La barra de estado del sistema no es sitio: la subida se corta ahí aunque
    // el exceso pida más.
    const r = calcularApartado({ tope: 30, suelo: 120, fotoTop: 60, fotoAlto: 252 });
    expect(r.subida).toBe(30);
    expect(r.escala).toBeGreaterThan(0);
  });

  it("no encoge por debajo del suelo de legibilidad", () => {
    // Caso patológico (móvil bajísimo con teclado): la foto se planta en los
    // 78px del recorte flotante y asoma por debajo de la hoja antes que
    // encogerse hasta no decir nada.
    const r = calcularApartado({ tope: 0, suelo: 40, fotoTop: 0, fotoAlto: 252 });
    expect(r.escala * 252).toBeCloseTo(78, 0);
  });

  it("se rinde con medidas imposibles en vez de mover la foto a ciegas", () => {
    expect(calcularApartado({ tope: 30, suelo: 10, fotoTop: 137, fotoAlto: 252 }))
      .toEqual({ subida: 0, escala: 1 });
    expect(calcularApartado({ tope: 30, suelo: 400, fotoTop: 137, fotoAlto: 0 }))
      .toEqual({ subida: 0, escala: 1 });
  });

  it("jamás devuelve una escala mayor que 1: la foto no se agranda", () => {
    // Aunque sobre hueco, el marco es el que es (reglas 5 y 7).
    const r = calcularApartado({ tope: 0, suelo: 900, fotoTop: 100, fotoAlto: 252 });
    expect(r.escala).toBe(1);
  });
});

describe("margenDeCrecimiento", () => {
  it("da el recorrido que la hoja puede subir sin comerse la foto", () => {
    // 360x780 con la hoja de marcas: 780 - 506 - 10 de aire - 6 de tope - 78 de
    // suelo = 180px de tirón. La hoja pasa de 506 a 686 y la foto acaba
    // midiendo exactamente el recorte flotante.
    expect(margenDeCrecimiento({ ventana: 780, alturaHoja: 506, tope: 6 })).toBe(180);
  });

  it("es cero cuando ya no queda hueco: no hay gesto hacia arriba", () => {
    // Teclado abierto en un móvil bajo. Estirar aquí solo taparía la foto.
    expect(margenDeCrecimiento({ ventana: 380, alturaHoja: 300, tope: 6 })).toBe(0);
  });
});
