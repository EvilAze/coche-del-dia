// lib/admin-handlers/dificultad.test.js
// Tests de la matemática de la ficha de rendimiento.
//
// Por qué existe: estas fórmulas son RÉPLICAS de las que viven en
// scripts/2026-06-difficulty-*.sql (el coste y su penalización por derrota). El
// panel y la base tienen que decir lo mismo del mismo coche; si divergen, nadie
// se entera hasta que una decisión se toma con el número equivocado. Es el
// mismo motivo por el que clasificarRepescas tiene tests en analytics.test.js.

import { describe, it, expect } from "vitest";
import { derivarMetricas, veredicto } from "./dificultad.js";

// Fila cruda tal y como la devuelve get_car_report.
const fila = (o = {}) => ({
  total_games: 0, wins: 0, losses: 0,
  attempt_1: 0, attempt_2: 0, attempt_3: 0, attempt_4: 0, attempt_5: 0,
  ...o,
});

describe("derivarMetricas", () => {
  it("sin partidas, todo lo que sea un ratio viene a null y no a cero", () => {
    // Un 0% de acierto y «no hay datos» son cosas distintas: pintar 0% donde no
    // se ha medido nada es inventarse el estado.
    const m = derivarMetricas(fila());
    expect(m.total).toBe(0);
    expect(m.winRate).toBeNull();
    expect(m.intentoMedio).toBeNull();
    expect(m.pBy3).toBeNull();
    expect(m.coste).toBeNull();
  });

  it("cuenta el % de acierto sobre el TOTAL, no sobre los que ganaron", () => {
    const m = derivarMetricas(
      fila({ total_games: 34, wins: 28, losses: 6,
             attempt_1: 4, attempt_2: 6, attempt_3: 9, attempt_4: 6, attempt_5: 3 })
    );
    expect(m.winRate).toBeCloseTo(28 / 34, 5);
  });

  it("el intento medio es de los que GANARON: perder no es un sexto intento", () => {
    const m = derivarMetricas(
      fila({ total_games: 34, wins: 28, losses: 6,
             attempt_1: 4, attempt_2: 6, attempt_3: 9, attempt_4: 6, attempt_5: 3 })
    );
    // (4*1 + 6*2 + 9*3 + 6*4 + 3*5) / 28 = 82/28
    expect(m.intentoMedio).toBeCloseTo(82 / 28, 5);
  });

  it("todos ganan al primer intento: intento medio 1 y coste 1", () => {
    const m = derivarMetricas(fila({ total_games: 10, wins: 10, attempt_1: 10 }));
    expect(m.intentoMedio).toBe(1);
    expect(m.coste).toBe(1);
    expect(m.winRate).toBe(1);
  });

  it("todos pierden: el coste es la penalización, y no hay intento medio", () => {
    const m = derivarMetricas(fila({ total_games: 10, losses: 10 }));
    expect(m.coste).toBe(7);
    expect(m.winRate).toBe(0);
    expect(m.intentoMedio).toBeNull();
  });

  it("el coste replica la fórmula del SQL: intentos + 7 por derrota, entre el total", () => {
    const m = derivarMetricas(
      fila({ total_games: 34, wins: 28, losses: 6,
             attempt_1: 4, attempt_2: 6, attempt_3: 9, attempt_4: 6, attempt_5: 3 })
    );
    expect(m.coste).toBeCloseTo((82 + 6 * 7) / 34, 5);
  });

  it("pBy3 cuenta 1º+2º+3º sobre el total de partidas", () => {
    const m = derivarMetricas(
      fila({ total_games: 34, wins: 28, losses: 6,
             attempt_1: 4, attempt_2: 6, attempt_3: 9, attempt_4: 6, attempt_5: 3 })
    );
    expect(m.pBy3).toBeCloseTo(19 / 34, 5);
  });

  it("aguanta nulos de la base sin propagarlos como NaN", () => {
    const m = derivarMetricas({ total_games: 5, wins: 5, losses: null, attempt_1: 5 });
    expect(m.coste).toBe(1);
    expect(Number.isNaN(m.coste)).toBe(false);
  });
});

describe("veredicto", () => {
  it("sin coste no se moja", () => {
    expect(veredicto(null).nivel).toBe("desconocido");
  });

  it("por debajo del objetivo menos 0,5 es demasiado fácil", () => {
    expect(veredicto(2.9).nivel).toBe("facil");
  });

  it("por encima del objetivo más 0,7 es demasiado difícil", () => {
    expect(veredicto(4.3).nivel).toBe("dificil");
  });

  it("en la banda de en medio, equilibrado", () => {
    expect(veredicto(3.5).nivel).toBe("equilibrado");
    expect(veredicto(3.65).nivel).toBe("equilibrado");
  });

  it("las bandas son ASIMÉTRICAS a propósito y los bordes caen dentro", () => {
    // Se tolera más dificultad que facilidad: un coche fácil se adivina de
    // reojo y se acabó la partida; uno difícil todavía se juega. Los límites
    // exactos (3,0 y 4,2) son equilibrado.
    expect(veredicto(3.0).nivel).toBe("equilibrado");
    expect(veredicto(4.2).nivel).toBe("equilibrado");
  });
});
