// @vitest-environment jsdom
//
// src/components/configurator/EndScreen.ficha.test.jsx
// «LA FICHA» DEL PANEL DE RESULTADO: las cifras encima del texto, y solo las
// que existen.
//
// Lo que se vigila es lo que se rompería sin que nada fallara: una casilla
// vacía o un «0 CV» por una cifra que falta, el texto desapareciendo cuando el
// coche tiene cifras (o al revés), y la ficha pintándose al PERDER si algún día
// el servidor la mandara por error (la regla 5 la reserva para la victoria, y
// el panel no debe ser el que la enseñe).
//
// Se monta EndScreen con todo lo que no es la ficha sustituido por nada: el
// armazón del modal, las estadísticas del día, las ofertas y la clasificación
// tienen sus propias pruebas y aquí solo harían ruido (y peticiones).

// React explícito: mismo motivo que en GuessForm.app.test.jsx.
import React from "react"; // eslint-disable-line no-unused-vars
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const COCHE = {
  img: null,
  marca: "Marca",
  modelo: "Modelo",
  anio: 2004,
  pais: "de",
  description: "La crónica del coche.",
  description_en: null,
  videoId: null,
  cifras: { potenciaCv: 510, parNm: 600, aceleracion: 3.9, vmaxKmh: 305 },
};
const INTENTO = {
  marca: { val: "Marca", status: "correct" },
  modelo: { val: "Modelo", status: "correct" },
  anio: { val: 2004, status: "correct" },
};

async function montar({ won = true, car = COCHE } = {}) {
  vi.resetModules();
  vi.doMock("./PanelFin", () => ({ default: ({ children }) => <div>{children}</div> }));
  vi.doMock("./RankParte", () => ({ default: () => null }));
  vi.doMock("./dailyStats", () => ({
    useDailyStats: () => ({ ready: false }),
    Distribution: () => null,
  }));
  vi.doMock("../NotificationOptIn", () => ({ default: () => null }));
  vi.doMock("../FaldonApp", () => ({ default: () => null }));
  vi.doMock("../../lib/edicionApp", () => ({
    momentoDeFaldon: () => false,
    faldonDescartado: () => true,
  }));
  vi.doMock("../Toast", () => ({ useToast: () => ({ push: vi.fn() }) }));
  vi.doMock("../../lib/haptics", () => ({ haptic: { impactLight: vi.fn() } }));
  vi.doMock("../../lib/analytics", () => ({ track: vi.fn() }));
  vi.doMock("../../lib/movimiento", () => ({ menosMovimiento: () => true }));
  vi.doMock("../../hooks/useCountdown", () => ({ useCountdown: () => ({ formatted: "12:00:00" }) }));
  vi.doMock("../../hooks/useSelloSentido", () => ({ useSelloSentido: () => undefined }));
  vi.doMock("../../i18n", () => ({
    useT: () => ({
      t: (clave, vars) => (vars ? `${clave}:${Object.values(vars).join(",")}` : clave),
      tn: (clave, n) => `${clave}:${n}`,
      locale: "es",
    }),
    getCarDescription: (c) => c?.description ?? null,
    getLocalizedCountry: (pais) => pais,
  }));

  const { default: EndScreen } = await import("./EndScreen");
  return render(
    <EndScreen
      won={won}
      car={car}
      guesses={[INTENTO]}
      max={5}
      streak={0}
      shareText="Coche del Día"
      user={{ id: "u" }}
      onClose={vi.fn()}
    />
  );
}

// La tarjeta de la ficha, localizada por su título.
const ficha = () => screen.queryByText("fin.ficha")?.closest("section") ?? null;
const filas = () =>
  [...(ficha()?.querySelectorAll(".fin-cifras > div") ?? [])].map((d) => [
    d.querySelector("dt").textContent,
    d.querySelector("dd").textContent,
  ]);

afterEach(cleanup);

describe("EndScreen · la ficha en cifras", () => {
  it("al ganar: las cuatro cifras, en orden, con la coma decimal y su unidad", async () => {
    await montar();
    expect(filas()).toEqual([
      ["fin.cifras.potencia", "510fin.cifras.cv"],
      ["fin.cifras.par", "600fin.cifras.nm"],
      ["fin.cifras.aceleracion", "3,9fin.cifras.s"],
      ["fin.cifras.vmax", "305fin.cifras.kmh"],
    ]);
  });

  it("las cifras van ENCIMA del texto, en la misma tarjeta", async () => {
    await montar();
    const hijos = [...ficha().children].map((el) => el.className || el.tagName);
    expect(hijos).toEqual(["fin-tarjeta-titulo", "fin-cifras", "cdd-note"]);
  });

  it("solo las que existen: sin casilla para la que falta", async () => {
    await montar({ car: { ...COCHE, cifras: { potenciaCv: 75, aceleracion: 14.5, vmaxKmh: 150 } } });
    expect(filas().map(([dt]) => dt)).toEqual([
      "fin.cifras.potencia",
      "fin.cifras.aceleracion",
      "fin.cifras.vmax",
    ]);
  });

  it("con cifras y sin crónica, la ficha sale igual (solo con las cifras)", async () => {
    await montar({ car: { ...COCHE, description: null } });
    expect(ficha()).not.toBeNull();
    expect(filas()).toHaveLength(4);
    expect(ficha().querySelector(".cdd-note")).toBeNull();
  });

  it("sin cifras, la ficha de siempre: título y texto", async () => {
    await montar({ car: { ...COCHE, cifras: null } });
    expect(ficha().querySelector(".fin-cifras")).toBeNull();
    expect(ficha().querySelector(".cdd-note").textContent).toBe("La crónica del coche.");
  });

  it("sin cifras ni crónica, no hay tarjeta", async () => {
    await montar({ car: { ...COCHE, cifras: null, description: null } });
    expect(ficha()).toBeNull();
  });

  it("al PERDER no hay ficha aunque las cifras llegaran (regla 5)", async () => {
    await montar({ won: false });
    expect(ficha()).toBeNull();
    expect(document.querySelector(".fin-cifras")).toBeNull();
  });
});
