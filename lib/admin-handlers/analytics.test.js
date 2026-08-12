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
import { clasificarRepescas, fetchPlataformas, serieDesdeMapa } from "./analytics.js";

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

describe("serieDesdeMapa", () => {
  // El bug que arregla: user_guesses mezcla registrados y sesiones anónimas
  // desde jul-2026, así que las series tienen que filtrar por is_anonymous.
  const anonIds = new Set(["anon-1", "anon-2"]);
  const esRegistrado = (id) => !anonIds.has(id);
  const esAnonimo = (id) => anonIds.has(id);

  const actividad = new Map([
    ["2026-07-29", new Set(["reg-1", "anon-1"])],
    ["2026-07-30", new Set(["reg-1", "reg-2", "anon-1", "anon-2"])],
  ]);

  it("separa registrados de anónimos el mismo día", () => {
    const reg = serieDesdeMapa(actividad, "2026-07-29", "2026-07-30", esRegistrado);
    const anon = serieDesdeMapa(actividad, "2026-07-29", "2026-07-30", esAnonimo);
    expect(reg.map((d) => d.count)).toEqual([1, 2]);
    expect(anon.map((d) => d.count)).toEqual([1, 2]);
  });

  it("las dos poblaciones suman el total de activos", () => {
    // Si esto se rompiera, la resta total − registrados del «% anónimos»
    // dejaría de cuadrar, que es exactamente lo que estaba pasando.
    const reg = serieDesdeMapa(actividad, "2026-07-29", "2026-07-30", esRegistrado);
    const anon = serieDesdeMapa(actividad, "2026-07-29", "2026-07-30", esAnonimo);
    const todos = serieDesdeMapa(actividad, "2026-07-29", "2026-07-30", () => true);
    reg.forEach((d, i) => expect(d.count + anon[i].count).toBe(todos[i].count));
  });

  it("rellena con 0 los días sin actividad y respeta el rango", () => {
    const s = serieDesdeMapa(actividad, "2026-07-28", "2026-07-31", esRegistrado);
    expect(s.map((d) => d.date)).toEqual([
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
    ]);
    expect(s.map((d) => d.count)).toEqual([0, 1, 2, 0]);
  });

  it("un mapa vacío da una serie de ceros, no una serie vacía", () => {
    // El chart necesita el eje X completo; un hueco lo descuadraría.
    const s = serieDesdeMapa(new Map(), "2026-07-29", "2026-07-30", () => true);
    expect(s).toHaveLength(2);
    expect(s.every((d) => d.count === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Accesos por plataforma (app vs web)
// ---------------------------------------------------------------------------
// Por qué se testea: es la única métrica del panel que separa la app del
// navegador, y sus dos fallos posibles son silenciosos. (1) Una cubeta mal
// asignada no da error, da un cero convincente — y un cero en "app" se lee como
// "la app no se usa", que es una conclusión de producto. (2) Meter 'legacy' en
// el denominador de la cuota haría que las semanas en las que la gente tarda en
// actualizar el APK parecieran una caída de uso.

// Cliente de mentira con la cadena de supabase-js que usa el fetch real:
// .from().select().eq().gte().lte() → { data, error }.
function supabaseFalso(respuesta) {
  const eslabon = {
    select: () => eslabon,
    eq: () => eslabon,
    gte: () => eslabon,
    lte: () => respuesta,
  };
  return { from: () => eslabon };
}

const filas = (data) => supabaseFalso({ data, error: null });

describe("fetchPlataformas", () => {
  it("reparte en app/web y rellena los días vacíos", async () => {
    const p = await fetchPlataformas(
      filas([
        { date: "2026-08-10", plataforma: "app", count: 3 },
        { date: "2026-08-10", plataforma: "web", count: 7 },
        { date: "2026-08-12", plataforma: "app", count: 5 },
      ]),
      "2026-08-10",
      "2026-08-12"
    );

    expect(p.migrationPending).toBe(false);
    // El día sin marcas tiene que existir con ceros: si desapareciera, la
    // gráfica dibujaría una barra donde no hubo nada.
    expect(p.series).toEqual([
      { date: "2026-08-10", app: 3, web: 7, legacy: 0 },
      { date: "2026-08-11", app: 0, web: 0, legacy: 0 },
      { date: "2026-08-12", app: 5, web: 0, legacy: 0 },
    ]);
    expect(p.totals).toEqual({ app: 8, web: 7, legacy: 0 });
  });

  it("suma las filas de la misma cubeta (user + anon del mismo día)", async () => {
    // feature_events tiene una fila por (event, date, auth, plataforma): un
    // mismo día y plataforma llegan DOS filas, una por auth. Si no se sumaran,
    // la gráfica enseñaría solo la última.
    const p = await fetchPlataformas(
      filas([
        { date: "2026-08-12", plataforma: "app", count: 4 },
        { date: "2026-08-12", plataforma: "app", count: 6 },
      ]),
      "2026-08-12",
      "2026-08-12"
    );
    expect(p.series[0].app).toBe(10);
    expect(p.totals.app).toBe(10);
  });

  it("deja 'legacy' FUERA del cálculo de la cuota de app", async () => {
    const p = await fetchPlataformas(
      filas([
        { date: "2026-08-12", plataforma: "app", count: 1 },
        { date: "2026-08-12", plataforma: "web", count: 1 },
        { date: "2026-08-12", plataforma: "legacy", count: 98 },
      ]),
      "2026-08-12",
      "2026-08-12"
    );
    // 1/(1+1) = 50%, no 1/100 = 1%.
    expect(p.appShare).toBe(0.5);
    expect(p.totals.legacy).toBe(98);
  });

  it("manda a 'legacy' cualquier plataforma desconocida", async () => {
    const p = await fetchPlataformas(
      filas([{ date: "2026-08-12", plataforma: "ios", count: 2 }]),
      "2026-08-12",
      "2026-08-12"
    );
    expect(p.totals).toEqual({ app: 0, web: 0, legacy: 2 });
    expect(p.appShare).toBe(null);
  });

  it("ignora filas de fechas fuera del rango sin descuadrar la serie", async () => {
    const p = await fetchPlataformas(
      filas([{ date: "2026-01-01", plataforma: "app", count: 9 }]),
      "2026-08-12",
      "2026-08-12"
    );
    expect(p.series).toHaveLength(1);
    expect(p.series[0].app).toBe(0);
  });

  it("appShare es null sin datos conocidos (y no 0, que se leería como 'nadie usa la app')", async () => {
    const p = await fetchPlataformas(filas([]), "2026-08-12", "2026-08-12");
    expect(p.appShare).toBe(null);
  });

  it("señala la migración pendiente si falta la tabla o la columna", async () => {
    for (const code of ["PGRST205", "42P01", "42703", "PGRST204"]) {
      const p = await fetchPlataformas(
        supabaseFalso({ data: null, error: { code } }),
        "2026-08-12",
        "2026-08-12"
      );
      expect(p).toEqual({ migrationPending: true });
    }
  });

  it("devuelve null ante un error de verdad (el panel avisa, no finge un cero)", async () => {
    const p = await fetchPlataformas(
      supabaseFalso({ data: null, error: { code: "57014", message: "timeout" } }),
      "2026-08-12",
      "2026-08-12"
    );
    expect(p).toBe(null);
  });
});
