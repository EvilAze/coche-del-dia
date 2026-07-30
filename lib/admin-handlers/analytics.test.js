// lib/admin-handlers/analytics.test.js
// Tests de la clasificación diaria-vs-repesca del panel de analítica.
//
// Por qué existe este fichero: el KPI «Repesca usage» estuvo mintiendo desde
// que se escribió (numerador acotado al rango contra denominador histórico) y
// nadie lo detectó porque no había forma automática de detectarlo. El criterio
// que decide qué partida es una repesca es además una RÉPLICA del que usa
// get_monthly_leaderboard en scripts/supabase-monthly-ranking.sql para pagarlas
// a mitad de puntos; si divergen, el panel y el ranking cuentan cosas distintas.

import { describe, it, expect } from "vitest";
import { clasificarRepescas } from "./analytics.js";

// Azúcar para no repetir el Map en cada caso.
const daily = (pares) => new Map(Object.entries(pares));

describe("clasificarRepescas", () => {
  it("una partida del coche del día NO es repesca", () => {
    const r = clasificarRepescas(
      [{ user_id: "u1", date: "2026-07-30", car_id: "coche-a" }],
      daily({ "2026-07-30": "coche-a" })
    );
    expect(r.plays).toBe(0);
    expect(r.usersUsed).toBe(0);
    expect(r.totalUsers).toBe(1);
    expect(r.rate).toBe(0);
  });

  it("una partida de OTRO coche en esa fecha sí es repesca", () => {
    const r = clasificarRepescas(
      [{ user_id: "u1", date: "2026-07-30", car_id: "coche-viejo" }],
      daily({ "2026-07-30": "coche-a" })
    );
    expect(r.plays).toBe(1);
    expect(r.usersUsed).toBe(1);
    expect(r.totalUsers).toBe(1);
  });

  it("cuenta PARTIDAS, no solo personas: dos repescas del mismo jugador suman 2", () => {
    // Esto es justo lo que stats.last_repesca_at no podía saber, porque es una
    // sola columna que se sobrescribe.
    const r = clasificarRepescas(
      [
        { user_id: "u1", date: "2026-07-29", car_id: "viejo-1" },
        { user_id: "u1", date: "2026-07-30", car_id: "viejo-2" },
      ],
      daily({ "2026-07-29": "coche-a", "2026-07-30": "coche-b" })
    );
    expect(r.plays).toBe(2);
    expect(r.usersUsed).toBe(1);
  });

  it("el denominador son los jugadores activos del rango, no el histórico", () => {
    // El bug original: 5 repescas contra 82 filas de stats de todos los tiempos
    // daba 6,1% cuando los activos reales eran ~17.
    const r = clasificarRepescas(
      [
        { user_id: "u1", date: "2026-07-30", car_id: "viejo-1" },
        { user_id: "u2", date: "2026-07-30", car_id: "coche-a" },
        { user_id: "u3", date: "2026-07-30", car_id: "coche-a" },
        { user_id: "u4", date: "2026-07-30", car_id: "coche-a" },
      ],
      daily({ "2026-07-30": "coche-a" })
    );
    expect(r.totalUsers).toBe(4);
    expect(r.usersUsed).toBe(1);
    expect(r.rate).toBe(0.25);
  });

  it("un jugador que juega varios días cuenta UNA vez en el denominador", () => {
    const r = clasificarRepescas(
      [
        { user_id: "u1", date: "2026-07-29", car_id: "coche-a" },
        { user_id: "u1", date: "2026-07-30", car_id: "coche-b" },
      ],
      daily({ "2026-07-29": "coche-a", "2026-07-30": "coche-b" })
    );
    expect(r.totalUsers).toBe(1);
    expect(r.plays).toBe(0);
  });

  it("sin coche del día para esa fecha NO clasifica como repesca", () => {
    // Un hueco en daily_cars no debe inflar el KPI: preferimos quedarnos cortos
    // a inventar repescas por un agujero de datos.
    const r = clasificarRepescas(
      [{ user_id: "u1", date: "2026-07-30", car_id: "coche-a" }],
      daily({})
    );
    expect(r.plays).toBe(0);
    expect(r.usersUsed).toBe(0);
    expect(r.totalUsers).toBe(1);
  });

  it("sin partidas devuelve rate null, no 0%", () => {
    // Un 0% parecería un dato real («nadie repesca»); null se pinta como «—».
    const r = clasificarRepescas([], daily({}));
    expect(r.rate).toBeNull();
    expect(r.totalUsers).toBe(0);
    expect(r.plays).toBe(0);
  });

  it("la tasa nunca puede pasar del 100%", () => {
    // Quien SOLO repesca ese día también entra en el denominador, así que
    // numerador ⊆ denominador por construcción.
    const r = clasificarRepescas(
      [
        { user_id: "u1", date: "2026-07-30", car_id: "viejo-1" },
        { user_id: "u2", date: "2026-07-30", car_id: "viejo-2" },
      ],
      daily({ "2026-07-30": "coche-a" })
    );
    expect(r.rate).toBe(1);
    expect(r.rate).toBeLessThanOrEqual(1);
  });
});
