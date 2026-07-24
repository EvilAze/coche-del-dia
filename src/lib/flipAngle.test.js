import { describe, it, expect } from "vitest";
import {
  liveAngle,
  settleAngle,
  showsBack,
  commitThreshold,
  FLIP_COMMIT_MAX_PX,
} from "./flipAngle";

describe("commitThreshold", () => {
  it("es una fracción del ancho en pantallas estrechas", () => {
    expect(commitThreshold(200)).toBeCloseTo(56, 5);
  });

  it("se topa en pantallas anchas para que el gesto no se haga largo", () => {
    expect(commitThreshold(1000)).toBe(FLIP_COMMIT_MAX_PX);
  });

  it("sobrevive a un ancho inválido", () => {
    expect(commitThreshold(0)).toBeGreaterThan(0);
    expect(commitThreshold(undefined)).toBeGreaterThan(0);
  });
});

describe("liveAngle", () => {
  it("sin arrastre no mueve la carta", () => {
    expect(liveAngle(0, 0, 300)).toBe(0);
    expect(liveAngle(180, 0, 300)).toBe(180);
  });

  // El sentido lo fija la mano, no la geometría: arrastrar a la derecha gira
  // hacia la derecha. Se probó con el signo contrario y se lee invertido.
  it("sigue al dedo: el ancho entero es media vuelta, hacia el mismo lado", () => {
    expect(liveAngle(0, 300, 300)).toBe(180);
    expect(liveAngle(0, -300, 300)).toBe(-180);
  });

  it("a mitad de recorrido va por el canto", () => {
    expect(liveAngle(0, 150, 300)).toBe(90);
  });

  it("parte del ángulo ya asentado", () => {
    expect(liveAngle(180, 150, 300)).toBe(270);
  });

  // Un arrastre muy largo no debe encadenar vueltas: dos giros dejan la carta
  // igual que estaba y se lee como que el gesto no ha hecho nada.
  it("no encadena más de media vuelta por gesto", () => {
    expect(liveAngle(0, 5000, 300)).toBe(180);
    expect(liveAngle(0, -5000, 300)).toBe(-180);
  });

  it("tolera entradas basura sin devolver NaN", () => {
    expect(liveAngle(0, undefined, 300)).toBe(0);
    expect(liveAngle(0, 100, 0)).not.toBeNaN();
  });
});

describe("settleAngle", () => {
  it("por debajo del umbral vuelve a su sitio", () => {
    expect(settleAngle(0, 10, 300)).toBe(0);
    expect(settleAngle(180, -20, 300)).toBe(180);
  });

  it("superado el umbral completa media vuelta en la dirección del gesto", () => {
    expect(settleAngle(0, 120, 300)).toBe(180);
    expect(settleAngle(0, -120, 300)).toBe(-180);
  });

  // El caso que motiva llevar el ángulo acumulado: tras voltear hacia la
  // izquierda, volver a arrastrar en el mismo sentido tiene que seguir
  // avanzando, no deshacer con un giro de 360°.
  it("encadena volteos respetando la dirección", () => {
    const primero = settleAngle(0, -120, 300);
    expect(primero).toBe(-180);
    expect(settleAngle(primero, -120, 300)).toBe(-360);
  });

  // Asentar tiene que ir en el MISMO sentido que iba el arrastre: si no, la
  // carta corrige el rumbo al soltar y se ve un tirón hacia atrás.
  it("el asentamiento no contradice al gesto en vivo", () => {
    const vivo = liveAngle(0, 120, 300);
    const fin = settleAngle(0, 120, 300);
    expect(Math.sign(fin)).toBe(Math.sign(vivo));
  });

  it("justo en el umbral aún no cuenta", () => {
    const umbral = commitThreshold(300);
    expect(settleAngle(0, umbral - 0.01, 300)).toBe(0);
    expect(settleAngle(0, umbral + 0.01, 300)).toBe(180);
  });
});

describe("showsBack", () => {
  it("de frente en los múltiplos pares de media vuelta", () => {
    expect(showsBack(0)).toBe(false);
    expect(showsBack(360)).toBe(false);
    expect(showsBack(-360)).toBe(false);
  });

  it("de dorso en los impares, gires hacia donde gires", () => {
    expect(showsBack(180)).toBe(true);
    expect(showsBack(-180)).toBe(true);
    expect(showsBack(540)).toBe(true);
  });

  it("cambia de cara al cruzar el canto", () => {
    expect(showsBack(89)).toBe(false);
    expect(showsBack(91)).toBe(true);
    expect(showsBack(269)).toBe(true);
    expect(showsBack(271)).toBe(false);
  });

  it("tolera un ángulo inválido", () => {
    expect(showsBack(undefined)).toBe(false);
    expect(showsBack(NaN)).toBe(false);
  });
});
