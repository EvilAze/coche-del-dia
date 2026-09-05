# Ficha de rendimiento por coche — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el panel interno enseñe, por coche, cuánta gente lo jugó, qué porcentaje acertó y en qué intento cayó — leído en vivo de la telemetría, y arreglando de paso el bloque de dificultad que lleva tiempo diciendo «sin datos» sin que nadie se enterara de por qué.

**Architecture:** Dos RPCs nuevas en Postgres (`get_car_report`, `list_car_reports`) que cruzan `daily_cars` × `daily_stats` × `user_guesses` y devuelven agregados crudos. Un handler admin nuevo (`car-report`) traduce a JSON y calcula las métricas derivadas **y el veredicto** en el servidor, siguiendo el criterio que `estado.js` ya deja escrito: los umbrales son política, no presentación. El panel solo pinta. No se añade ninguna columna a `public.cars`: la ficha lee la fuente, no una caché, precisamente porque la caché es lo que ha fallado.

**Tech Stack:** Postgres/Supabase (PL/pgSQL + SQL functions, `security definer`), Vercel Functions (Node, ESM), React 18 + Tailwind, Vitest.

---

## Contexto imprescindible

Lee el diseño antes de empezar:
`docs/superpowers/specs/2026-09-05-ficha-de-rendimiento-por-coche-design.md`

Cinco cosas del proyecto que hay que respetar y que no son obvias:

1. **Los endpoints admin NO son funciones serverless propias.** Vercel Hobby
   permite 12 y ya vamos justos, así que todos pasan por el dispatcher
   `api/admin/[...slug].js`, y los handlers viven en `lib/admin-handlers/`
   (fuera de `api/` a propósito). Un endpoint nuevo = un fichero en
   `lib/admin-handlers/` + una entrada en `ROUTES`. **No crees ficheros en
   `api/admin/`.**
2. **El plazo lo pone el dispatcher**, no el handler (`PLAZO_MS`). El nuestro se
   queda con el `_default` de 15 s: son lecturas cortas. No añadas `conTimeout`
   dentro del handler.
3. **Nunca `const supabase = createClient(...)` a nivel de módulo.** Siempre
   `getSupabaseAdmin()` (getter perezoso).
4. **Comentarios en español explicando el PORQUÉ**, no el qué. Es la convención
   densa de este repo; mira `estado.js` como referencia de tono.
5. **`supabase-js` no lanza ante un error de Postgres**: resuelve con
   `{ data, error }`. Ese detalle es la causa del bug que arreglamos en la
   Tarea 2 — no lo repitas en el código nuevo.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `scripts/2026-09-ficha-rendimiento-coche.sql` **(crear)** | Las dos RPCs y sus grants. Idempotente. |
| `lib/admin-handlers/car-report.js` **(crear)** | Handler `GET /api/admin/car-report`. Traduce la RPC a JSON. |
| `lib/admin-handlers/dificultad.js` **(crear)** | Matemática derivada y veredicto, **puras**. Único sitio con las constantes. |
| `lib/admin-handlers/dificultad.test.js` **(crear)** | Tests de lo anterior. |
| `src/admin/FichaRendimiento.jsx` **(crear)** | El componente de la ficha. Solo pinta. |
| `api/admin/[...slug].js` **(modificar)** | Una entrada más en `ROUTES`. |
| `lib/admin-handlers/save-car.js` **(modificar)** | Arreglar el `catch` mudo. |
| `lib/admin-handlers/analytics.js` **(modificar)** | `hardestCars` pasa a salir de `list_car_reports`. |
| `src/admin/EditCarPanel.jsx` **(modificar)** | Monta la ficha; `DifficultyIntel` se queda solo con la sugerencia de zoom. |
| `src/admin/AnalyticsPanel.jsx` **(modificar)** | La tabla gana orden configurable. |

---

## Task 1: Las dos RPCs

**Files:**
- Create: `scripts/2026-09-ficha-rendimiento-coche.sql`

No hay test automático aquí: el SQL vive en Supabase y no hay entorno de base de
datos en CI. La verificación es ejecutarlo y leer lo que devuelven las consultas
de comprobación del final, que van incluidas en el propio fichero.

- [ ] **Step 1: Crear el fichero SQL**

```sql
-- 2026-09-ficha-rendimiento-coche.sql
-- La FICHA DE RENDIMIENTO del panel interno: cuánta gente jugó cada coche, qué
-- porcentaje acertó y en qué intento cayó.
--
-- POR QUÉ UNA RPC EN VIVO Y NO MÁS COLUMNAS EN cars:
--   Ya existe una vía basada en columnas cacheadas (cars.difficulty_*, que
--   escribe recompute_car_difficulty). Lleva tiempo rota y nadie se enteró
--   porque el fallo era mudo. Ampliarla habría sido apostar otra vez por el
--   mecanismo que acaba de fallar; leyendo la fuente, la ficha funciona aunque
--   el recálculo siga roto. Además así no se toca public.cars y no hay que
--   decidir ningún GRANT (regla 3 del CLAUDE.md).
--
-- POR QUÉ daily_stats Y NO user_guesses (para el modo diario):
--   daily_stats agrega POR FECHA y cuenta a TODA la audiencia, anónimos
--   incluidos; user_guesses solo tiene a quien arrastra sesión. Como cada coche
--   ocupa una fecha, el JOIN por date atribuye el agregado 1:1 al coche. Es el
--   mismo criterio que ya usa recompute_car_difficulty.
--
-- AMBAS SON ADMIN-ONLY: revoke a public, grant solo a service_role. Leen
-- daily_cars y daily_stats, cerradas al cliente, y dicen qué coche tocó qué
-- día — o sea, justo lo que la regla 5 del CLAUDE.md no deja salir.
--
-- Ejecutar en el SQL Editor de Supabase. Idempotente.

-- ============================================================================
-- get_car_report(car_id) — la ficha de UN coche
-- ============================================================================
-- Devuelve SIEMPRE una fila, incluso si el coche no se ha emitido nunca: en ese
-- caso aired_on viene a null y los contadores a 0. Es información («aún no ha
-- salido»), no un error, y que el handler no tenga que distinguir entre «sin
-- fila» y «sin datos» le quita una rama.
create or replace function public.get_car_report(p_car_id uuid)
returns table (
  aired_on      date,
  aired_count   int,
  total_games   int,
  wins          int,
  losses        int,
  attempt_1     int,
  attempt_2     int,
  attempt_3     int,
  attempt_4     int,
  attempt_5     int,
  repesca_plays int,
  repesca_wins  int
)
language sql
stable
security definer
set search_path = public
as $$
  with emisiones as (
    -- Normalmente una sola fila (pick_daily_car no repite coche), pero un
    -- cambio de emergencia puede crear otra. Se suman todas y aired_count lo
    -- deja ver en vez de esconderlo.
    select dc.date from public.daily_cars dc where dc.car_id = p_car_id
  ),
  diario as (
    select
      min(e.date)                           as aired_on,
      count(*)::int                         as aired_count,
      coalesce(sum(ds.total_games), 0)::int as total_games,
      coalesce(sum(ds.wins), 0)::int        as wins,
      coalesce(sum(ds.losses), 0)::int      as losses,
      coalesce(sum(ds.attempt_1), 0)::int   as attempt_1,
      coalesce(sum(ds.attempt_2), 0)::int   as attempt_2,
      coalesce(sum(ds.attempt_3), 0)::int   as attempt_3,
      coalesce(sum(ds.attempt_4), 0)::int   as attempt_4,
      coalesce(sum(ds.attempt_5), 0)::int   as attempt_5
    -- LEFT JOIN: un día programado que todavía no tiene fila en daily_stats
    -- (nadie ha terminado aún) tiene que contar como emisión con 0 partidas,
    -- no desaparecer. Es exactamente el caso del coche de hoy por la mañana.
    from emisiones e
    left join public.daily_stats ds on ds.date = e.date
  ),
  repesca as (
    -- Partidas de ESTE coche en fechas que NO son las suyas de emisión: eso es
    -- una repesca. Va aparte y NO se suma al histograma: en repesca veterano
    -- solo hay UN intento, así que mezclarla falsearía el ratio de fallo. Es el
    -- mismo criterio que aplica clasificarRepescas en el panel de analítica.
    --
    -- Aquí sí es user_guesses porque la repesca exige JWT y daily_stats no la
    -- registra: no hay agregado del que tirar.
    select
      (count(*) filter (where ug.status in ('won', 'lost')))::int as plays,
      (count(*) filter (where ug.status = 'won'))::int            as wins
    from public.user_guesses ug
    where ug.car_id = p_car_id
      -- Si el coche nunca se emitió, `emisiones` está vacía y este NOT IN es
      -- TRUE para todo: correcto, porque entonces cualquier partida suya ES
      -- una repesca. daily_cars.date es NOT NULL, así que no hay trampa de
      -- NULL en el NOT IN.
      and ug.date not in (select date from emisiones)
  )
  select
    d.aired_on, d.aired_count, d.total_games, d.wins, d.losses,
    d.attempt_1, d.attempt_2, d.attempt_3, d.attempt_4, d.attempt_5,
    r.plays, r.wins
  from diario d cross join repesca r;
$$;

revoke all on function public.get_car_report(uuid) from public;
grant execute on function public.get_car_report(uuid) to service_role;

-- ============================================================================
-- list_car_reports() — lo mismo para TODOS, para la tabla comparativa
-- ============================================================================
-- SIN repesca a propósito: la tabla compara coches entre sí y tiene que comparar
-- lo mismo en todos. La repesca se queda en la ficha individual.
--
-- SIN ordenar y SIN limitar, también a propósito: pasar un criterio de orden
-- como texto obligaría a SQL dinámico dentro de una función security definer, y
-- son unos cientos de filas — ordenarlas en el panel es trivial y no abre esa
-- puerta.
create or replace function public.list_car_reports()
returns table (
  car_id      uuid,
  make        text,
  model       text,
  year        int,
  aired_on    date,
  total_games int,
  wins        int,
  losses      int,
  attempt_1   int,
  attempt_2   int,
  attempt_3   int,
  attempt_4   int,
  attempt_5   int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    dc.car_id,
    c.make,
    c.model,
    c.year,
    min(dc.date)              as aired_on,
    sum(ds.total_games)::int  as total_games,
    sum(ds.wins)::int         as wins,
    sum(ds.losses)::int       as losses,
    sum(ds.attempt_1)::int    as attempt_1,
    sum(ds.attempt_2)::int    as attempt_2,
    sum(ds.attempt_3)::int    as attempt_3,
    sum(ds.attempt_4)::int    as attempt_4,
    sum(ds.attempt_5)::int    as attempt_5
  from public.daily_cars dc
  join public.cars c        on c.id = dc.car_id
  join public.daily_stats ds on ds.date = dc.date
  -- INNER JOIN y este filtro: a la tabla comparativa solo le interesan los
  -- coches que YA tienen partidas. Los programados sin jugar todavía no
  -- comparan nada.
  where ds.total_games > 0
  group by dc.car_id, c.make, c.model, c.year;
$$;

revoke all on function public.list_car_reports() from public;
grant execute on function public.list_car_reports() to service_role;

-- ============================================================================
-- COMPROBACIÓN (ejecutar y leer; no modifica nada)
-- ============================================================================
-- 1) ¿Cuántos coches tienen ficha con partidas? Un recuento, no una lista:
--    enumerar coches con sus fechas en un fichero versionado sería regalar el
--    calendario (regla 20 del CLAUDE.md, este repo es PÚBLICO).
select count(*) as coches_con_ficha from public.list_car_reports();

-- 2) ¿Cuadra el total con la telemetría bruta? Estas dos cifras tienen que
--    coincidir; si no, el JOIN por fecha está perdiendo días.
select
  (select coalesce(sum(total_games), 0) from public.list_car_reports()) as via_rpc,
  (select coalesce(sum(ds.total_games), 0)
     from public.daily_stats ds
     join public.daily_cars dc on dc.date = ds.date)                    as via_join_directo;

-- 3) La ficha de un coche cualquiera que ya se haya emitido, para ver la forma
--    del resultado. Sin nombrarlo: se coge el que salga.
select * from public.get_car_report(
  (select dc.car_id
     from public.daily_cars dc
     join public.daily_stats ds on ds.date = dc.date
    where ds.total_games > 0
    order by dc.date desc
    limit 1)
);
```

- [ ] **Step 2: Ejecutar el SQL en el editor de Supabase**

Pega el fichero entero. Espera:
- Sin errores en los `create` ni en los `grant`.
- Comprobación 1: un número ≥ 0.
- Comprobación 2: **las dos columnas iguales**. Si difieren, para y avisa: el
  JOIN por fecha está perdiendo días y el resto del plan asume que no.
- Comprobación 3: una fila con `aired_on` puesto y `total_games` > 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/2026-09-ficha-rendimiento-coche.sql
git commit -m "feat(db): get_car_report y list_car_reports, la ficha leída en vivo

La telemetría por coche ya se calculaba, pero contra columnas cacheadas en
cars.difficulty_* que llevan tiempo sin escribirse. Estas dos funciones leen
daily_stats directamente, así que la ficha del panel funciona aunque el
recálculo siga roto.

Admin-only: revoke a public y grant solo a service_role. Dicen qué coche
tocó qué día, que es justo lo que la regla 5 no deja salir del servidor."
```

---

## Task 2: El fallo mudo de save-car

**Files:**
- Modify: `lib/admin-handlers/save-car.js:155-162`

Sin test: comprobarlo exigiría simular un error de Supabase montando un doble de
todo el cliente, y el cambio es una comprobación de tres líneas cuyo valor está
justo en el entorno real. La verificación es el diagnóstico SQL.

- [ ] **Step 1: Sustituir el bloque**

Busca esto en `lib/admin-handlers/save-car.js`:

```js
      // Recalcular dificultad por telemetría de forma síncrona en el GET (best-effort).
      // De esta forma, el administrador siempre verá los datos de intentos/partidas
      // reales y actualizados al segundo sin tener que esperar a que corra el cron diario.
      try {
        await getSupabaseAdmin().rpc("recompute_car_difficulty");
      } catch (rpcErr) {
        console.warn("[admin/save-car get] no se pudo recalcular la dificultad:", rpcErr);
      }
```

Reemplázalo por:

```js
      // Recalcular dificultad por telemetría de forma síncrona en el GET
      // (best-effort): así la sugerencia de zoom está al segundo sin esperar al
      // cron. Las MÉTRICAS de la ficha ya no dependen de esto — las sirve
      // /api/admin/car-report leyendo daily_stats en vivo — pero
      // suggested_zoom_base sí, porque sale de estas columnas.
      //
      // OJO CON EL PATRÓN: esto estuvo escrito como un `await` dentro de un
      // try/catch sin mirar `error`, y así el bloque de dificultad del panel
      // pasó meses diciendo «sin datos» sin dejar rastro. supabase-js NO lanza
      // cuando Postgres devuelve error: resuelve con { data, error }, así que
      // el catch no se disparaba nunca. Un fallo best-effort puede no romper la
      // respuesta, pero tiene que DEJAR HUELLA.
      const { error: rpcError } = await getSupabaseAdmin()
        .rpc("recompute_car_difficulty");
      if (rpcError) {
        console.error(
          "[admin/save-car get] recompute_car_difficulty falló:",
          rpcError.message || rpcError
        );
      }
```

- [ ] **Step 2: Comprobar que no se ha roto el arranque**

Run: `npm run build`
Expected: build en verde.

- [ ] **Step 3: Ejecutar el diagnóstico contra Supabase**

Pega `scripts/2026-09-diagnostico-dificultad.sql` en el SQL Editor.

Lee el **PASO 1**:
- **2 filas** → hay dos sobrecargas y la llamada sin argumentos es ambigua. Esa
  es la causa. Arréglalo dropeando la de 8 argumentos, que es la que el
  significance-gate quiso retirar:
  ```sql
  drop function if exists public.recompute_car_difficulty(real, real, real, real, integer, real, real, real);
  ```
  Vuelve a ejecutar el PASO 4 y el PASO 5 para confirmar que ahora escribe.
- **0 filas** → la función no existe: ejecuta `scripts/2026-06-difficulty-observatory.sql`
  y después `scripts/2026-06-difficulty-significance-gate.sql`, en ese orden.
- **1 fila** → la sobrecarga está bien; el error real te lo dirá el PASO 4, que
  ahora sí lo enseña.

Anota en el PR qué salió: es la única prueba de que el bug está cerrado.

- [ ] **Step 4: Commit**

```bash
git add lib/admin-handlers/save-car.js
git commit -m "fix(admin): el recálculo de dificultad fallaba en silencio

supabase-js no lanza cuando Postgres devuelve error: resuelve con
{ data, error }. La llamada estaba envuelta en un try/catch que no miraba
`error`, así que el catch no se disparó jamás y el bloque de dificultad del
panel pasó meses diciendo «sin datos» sin dejar una sola línea de log.

Sigue siendo best-effort —un fallo aquí no debe tumbar la lectura del
coche— pero ahora deja huella. El cron ya lo hacía bien; era este camino el
que estaba ciego."
```

---

## Task 3: La matemática derivada, pura y con tests

**Files:**
- Create: `lib/admin-handlers/dificultad.js`
- Create: `lib/admin-handlers/dificultad.test.js`

Por qué en su propio módulo y no dentro del handler: el coste objetivo (3,5) ya
está copiado en `analytics.js` y en `EditCarPanel.jsx`, y la penalización por
derrota (7,0) vive además en el SQL. Iban camino de cuatro copias. Aquí quedan
en una, con su test.

- [ ] **Step 1: Escribir el test que falla**

Crea `lib/admin-handlers/dificultad.test.js`:

```js
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
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `npx vitest run lib/admin-handlers/dificultad.test.js`
Expected: FAIL — `Failed to resolve import "./dificultad.js"`.

- [ ] **Step 3: Escribir el módulo**

Crea `lib/admin-handlers/dificultad.js`:

```js
// lib/admin-handlers/dificultad.js
// La matemática de la dificultad observada, en un solo sitio y pura.
//
// POR QUÉ SEPARADA DEL HANDLER: estas dos constantes venían multiplicándose por
// el repo — el coste objetivo estaba copiado en analytics.js y en
// EditCarPanel.jsx, y la penalización por derrota vive además en el default de
// las RPCs de scripts/2026-06-difficulty-*.sql. Cuatro copias de un número que
// tiene que ser el mismo, y ninguna forma automática de notar que dejaron de
// serlo. Aquí quedan en una, con tests.
//
// POR QUÉ EL VEREDICTO ES DEL SERVIDOR Y NO DEL JSX: mismo criterio que
// estado.js deja escrito — los umbrales son POLÍTICA («¿a partir de cuándo un
// coche es demasiado difícil?»), no presentación. Puestos en el componente se
// convierten en números sueltos entre clases de Tailwind, que es donde nadie
// los encuentra para discutirlos.

// Coste objetivo: la moda cae entre el 3º y el 4º intento. Réplica del default
// p_target_cost de recompute_car_difficulty.
export const COSTE_OBJETIVO = 3.5;

// Lo que "cuesta" una derrota. Mayor que 5 a propósito: perder duele más que
// llegar apurado al quinto intento. Réplica del default p_loss_penalty.
export const PENALIZACION_DERROTA = 7.0;

// Bandas del veredicto, ASIMÉTRICAS a propósito: se tolera más dificultad que
// facilidad. Un coche fácil se adivina de reojo y la partida se acaba antes de
// empezar; uno difícil, aunque incomode, todavía se juega.
const MARGEN_FACIL = 0.5;
const MARGEN_DIFICIL = 0.7;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Convierte la fila cruda de get_car_report en lo que la ficha necesita
// enseñar. Los ratios vienen a null cuando no hay partidas: un 0% donde no se
// ha medido nada sería inventarse el estado, y eso ya nos ha costado un
// disgusto (regla 21 del CLAUDE.md, «degradar no es inventarse el estado»).
export function derivarMetricas(fila) {
  const total = num(fila?.total_games);
  const wins = num(fila?.wins);
  const losses = num(fila?.losses);
  const intentos = [
    num(fila?.attempt_1), num(fila?.attempt_2), num(fila?.attempt_3),
    num(fila?.attempt_4), num(fila?.attempt_5),
  ];

  if (total === 0) {
    return {
      total: 0, wins, losses, intentos,
      winRate: null, intentoMedio: null, pBy3: null, coste: null,
    };
  }

  // Σ(nº de intento × cuántos ganaron en él). Es el numerador tanto del intento
  // medio como del coste, así que se calcula una vez.
  const sumaIntentosGanados = intentos.reduce((acc, n, i) => acc + n * (i + 1), 0);

  return {
    total,
    wins,
    losses,
    intentos,
    winRate: wins / total,
    // Solo entre los que ganaron: una derrota no es "un sexto intento", es otra
    // cosa, y promediarla aquí mezclaría dos magnitudes.
    intentoMedio: wins > 0 ? sumaIntentosGanados / wins : null,
    pBy3: (intentos[0] + intentos[1] + intentos[2]) / total,
    coste: (sumaIntentosGanados + losses * PENALIZACION_DERROTA) / total,
  };
}

// Lectura humana del coste. Devuelve nivel + texto; el color lo elige el
// componente a partir del nivel, que es lo único que es presentación.
export function veredicto(coste) {
  if (typeof coste !== "number" || !Number.isFinite(coste)) {
    return { nivel: "desconocido", texto: "Sin datos suficientes" };
  }
  if (coste < COSTE_OBJETIVO - MARGEN_FACIL) {
    return { nivel: "facil", texto: "Demasiado fácil" };
  }
  if (coste > COSTE_OBJETIVO + MARGEN_DIFICIL) {
    return { nivel: "dificil", texto: "Demasiado difícil" };
  }
  return { nivel: "equilibrado", texto: "Equilibrado" };
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `npx vitest run lib/admin-handlers/dificultad.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/admin-handlers/dificultad.js lib/admin-handlers/dificultad.test.js
git commit -m "feat(admin): la matemática de la dificultad, en un sitio y con tests

El coste objetivo (3,5) estaba copiado en analytics.js y en EditCarPanel.jsx,
y la penalización por derrota (7,0) vive además en el SQL: cuatro copias de
un número que tiene que ser el mismo y ninguna forma de notar que dejaran de
serlo.

Los ratios vienen a null cuando no hay partidas en vez de a cero: un 0% de
acierto y «no se ha medido» son cosas distintas."
```

---

## Task 4: El handler `car-report`

**Files:**
- Create: `lib/admin-handlers/car-report.js`
- Modify: `api/admin/[...slug].js`

- [ ] **Step 1: Escribir el handler**

Crea `lib/admin-handlers/car-report.js`:

```js
// lib/admin-handlers/car-report.js
// La FICHA DE RENDIMIENTO de un coche:
//
//   GET /api/admin/car-report            → el coche de HOY
//   GET /api/admin/car-report?id=<uuid>  → ese coche
//
// El agregado lo hace la RPC get_car_report
// (scripts/2026-09-ficha-rendimiento-coche.sql); aquí solo se derivan las
// métricas y el veredicto, que viven en dificultad.js para no volver a tener el
// mismo número escrito en cuatro sitios.
//
// POR QUÉ EL DEFAULT ES EL COCHE DE HOY: es la pregunta que más veces se hace
// («¿cómo va lo de hoy?») y así el panel puede abrir enseñándola sin que el
// front tenga que averiguar antes qué coche toca.
//
// LEE daily_cars, NO llama a pick_daily_car: mirar la ficha no puede tener el
// efecto secundario de FIJAR el coche del día. Si hoy aún no está sorteado,
// se contesta honestamente que no hay.

import { getSupabaseAdmin, getMissingAdminEnvs } from "../../api/_lib/supabase.js";
import { requireAdmin } from "../../api/_lib/auth.js";
import { methodGuard } from "../../api/_lib/http.js";
import { todayInMadrid } from "../../api/_lib/date.js";
import { derivarMetricas, veredicto, COSTE_OBJETIVO } from "./dificultad.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (methodGuard(req, res, "GET")) return;

  try {
    if (!getSupabaseAdmin()) {
      console.error(
        `[admin/car-report] missing env vars: ${getMissingAdminEnvs().join(", ")}`
      );
      return res.status(500).json({ error: "Server misconfigured" });
    }

    const { error: authError } = await requireAdmin(req);
    if (authError) {
      return res.status(authError.status).json({ error: authError.message });
    }

    const hoy = todayInMadrid();
    const idQ = typeof req.query?.id === "string" ? req.query.id.trim() : "";

    let carId = idQ;
    if (!carId) {
      // Sin id: resolvemos el coche de hoy leyendo daily_cars. Un SELECT, nunca
      // pick_daily_car (ver cabecera).
      const { data: fila, error: hoyError } = await getSupabaseAdmin()
        .from("daily_cars")
        .select("car_id")
        .eq("date", hoy)
        .maybeSingle();
      if (hoyError) {
        console.error("[admin/car-report] daily_cars hoy:", hoyError.message);
        return res.status(500).json({ error: "DB error" });
      }
      if (!fila) {
        // Todavía no hay sorteo para hoy. No es un error: es un estado.
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json({ carId: null, hoy, sinCocheHoy: true });
      }
      carId = fila.car_id;
    } else if (!UUID_RE.test(carId)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const { data, error } = await getSupabaseAdmin().rpc("get_car_report", {
      p_car_id: carId,
    });
    if (error) {
      console.error("[admin/car-report] rpc:", error.message);
      return res.status(500).json({ error: "DB error", detalle: error.message });
    }

    // La RPC devuelve TABLE: un array de una fila.
    const r = Array.isArray(data) ? data[0] : data;
    if (!r) {
      return res.status(500).json({ error: "Sin datos" });
    }

    const m = derivarMetricas(r);
    // El día no ha cerrado: las cifras son parciales y el panel tiene que
    // decirlo. Sin esto, un 40% de acierto a las once de la mañana se lee como
    // el resultado final del coche.
    const enCurso = r.aired_on != null && String(r.aired_on) === hoy;

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      carId,
      hoy,
      emitido: r.aired_on ?? null,
      emisiones: r.aired_count ?? 0,
      enCurso,
      diario: {
        partidas: m.total,
        aciertos: m.wins,
        fallos: m.losses,
        intentos: m.intentos,
        winRate: m.winRate,
        intentoMedio: m.intentoMedio,
        pBy3: m.pBy3,
        coste: m.coste,
      },
      // Aparte y sin sumarse al histograma: en repesca veterano solo hay un
      // intento, así que mezclarla falsearía el ratio de fallo.
      repesca: {
        partidas: r.repesca_plays ?? 0,
        aciertos: r.repesca_wins ?? 0,
      },
      veredicto: veredicto(m.coste),
      costeObjetivo: COSTE_OBJETIVO,
    });
  } catch (err) {
    console.error("[admin/car-report] UNCAUGHT:", err?.stack || err);
    return res.status(500).json({
      error: "Internal error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : String(err?.message || err),
    });
  }
}
```

- [ ] **Step 2: Registrar la ruta en el dispatcher**

En `api/admin/[...slug].js`, añade el import junto a los demás:

```js
import carReport from "../../lib/admin-handlers/car-report.js";
```

Y la entrada en `ROUTES`, después de `"analytics"`:

```js
  "car-report":    carReport,
```

**No toques `PLAZO_MS`**: el `_default` de 15 s le sobra — son dos lecturas
cortas a Supabase.

- [ ] **Step 3: Comprobar que el bundle sigue montando**

Run: `npm run build`
Expected: build en verde. Si el import está mal escrito, falla aquí.

- [ ] **Step 4: Commit**

```bash
git add lib/admin-handlers/car-report.js api/admin/\[...slug\].js
git commit -m "feat(admin): endpoint car-report, con el coche de hoy por defecto

Sin id devuelve la ficha del coche del día, que es la pregunta que más veces
se hace. Resuelve hoy LEYENDO daily_cars, nunca llamando a pick_daily_car:
mirar la ficha no puede tener el efecto secundario de fijar el coche del día.

Marca enCurso cuando el día no ha cerrado. Sin esa marca, un 40% de acierto
a media mañana se lee como el resultado final del coche."
```

---

## Task 5: El componente de la ficha

**Files:**
- Create: `src/admin/FichaRendimiento.jsx`
- Modify: `src/admin/EditCarPanel.jsx`

`src/admin/` está exento de `test:estetica` (regla 16), pero el panel tiene su
propio estilo: oscuro, `border-white/10`, `bg-black/30`, `text-muted`, rótulos
en versalitas con `tracking`. Cópialo de `DifficultyIntel`, que está justo al
lado. **Sin emoji.**

- [ ] **Step 1: Escribir el componente**

Crea `src/admin/FichaRendimiento.jsx`:

```jsx
// src/admin/FichaRendimiento.jsx
// La ficha de rendimiento de un coche: cuánta gente lo jugó, qué porcentaje
// acertó y EN QUÉ INTENTO cayó.
//
// El histograma es lo que justifica la ficha entera. Dos coches con el mismo
// 82% de acierto son cosas opuestas si en uno la moda cae en el primer intento
// (lo adivinaron de reojo) y en otro en el quinto (sufrieron hasta el final), y
// ese matiz no cabe en ningún promedio.
//
// Este componente NO calcula: las métricas y el veredicto vienen resueltos de
// /api/admin/car-report, porque los umbrales son política y no presentación
// (mismo criterio que estado.js). Aquí solo se elige el color del nivel.

const COLOR_VEREDICTO = {
  facil: "text-amber-300",
  dificil: "text-rose-300",
  equilibrado: "text-emerald-300",
  desconocido: "text-muted",
};

const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const num1 = (v) => (v == null ? "—" : v.toFixed(1));

function Cifra({ rotulo, valor }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-1.5 text-center">
      <div className="font-display text-sm text-white">{valor}</div>
      <div className="text-[9px] uppercase tracking-widest text-muted">{rotulo}</div>
    </div>
  );
}

// Histograma de en qué intento cayó. Alturas en % sobre la barra más alta, no
// sobre el total: con 34 partidas repartidas en seis cajas, escalar sobre el
// total deja todas las barras a ras de suelo y no se lee nada.
function Histograma({ intentos, fallos }) {
  const barras = [
    ...intentos.map((n, i) => ({ etiqueta: `${i + 1}º`, n, perdida: false })),
    { etiqueta: "falló", n: fallos, perdida: true },
  ];
  const maximo = Math.max(...barras.map((b) => b.n), 1);

  return (
    <div className="mt-2">
      <div className="grid grid-cols-6 gap-1.5">
        {barras.map((b) => (
          <div key={b.etiqueta} className="flex h-20 flex-col justify-end gap-1">
            <div className="text-center font-mono text-[10px] text-white/70">{b.n}</div>
            <div
              className={`rounded-t-sm ${b.perdida ? "bg-rose-400/70" : "bg-emerald-400/60"}`}
              style={{ height: `${Math.max((b.n / maximo) * 100, 2)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-6 gap-1.5 border-t border-white/10 pt-1">
        {barras.map((b) => (
          <div key={b.etiqueta} className="text-center font-mono text-[9px] text-muted">
            {b.etiqueta}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FichaRendimiento({ ficha, cargando, error }) {
  if (cargando) {
    return <p className="mt-2 text-[11px] text-muted">Cargando la ficha…</p>;
  }
  if (error) {
    // Honesto: mejor decir que no se pudo leer que pintar ceros que parecerían
    // un resultado real.
    return (
      <p className="mt-2 text-[11px] text-rose-300">
        No se pudo leer la ficha: {error}
      </p>
    );
  }
  if (!ficha) return null;

  const { emitido, emisiones, enCurso, diario, repesca, veredicto: v, costeObjetivo } = ficha;

  if (!emitido) {
    return (
      <div className="mt-2 rounded-xl border border-white/10 bg-black/30 px-3 py-3">
        <p className="text-[11px] leading-relaxed text-muted">
          Este coche aún no ha salido como coche del día, así que no hay nada
          medido. Aparecerá aquí en cuanto se juegue.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted">
          Ficha de rendimiento
        </span>
        <span className="font-mono text-[10px] text-muted">
          {new Date(emitido).toLocaleDateString("es")}
          {emisiones > 1 ? ` · ${emisiones} emisiones` : ""}
        </span>
      </div>

      {enCurso && (
        <p className="rounded-md border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[10px] text-amber-200">
          Se está jugando ahora mismo: las cifras son parciales y cambiarán
          hasta medianoche.
        </p>
      )}

      {diario.partidas === 0 ? (
        <p className="text-[11px] text-muted">
          Todavía no ha terminado ninguna partida.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            <Cifra rotulo="partidas" valor={diario.partidas.toLocaleString("es")} />
            <Cifra rotulo="acierto" valor={pct(diario.winRate)} />
            <Cifra rotulo="intento medio" valor={num1(diario.intentoMedio)} />
            <Cifra rotulo="en ≤3" valor={pct(diario.pBy3)} />
          </div>

          <Histograma intentos={diario.intentos} fallos={diario.fallos} />

          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[10px]">
            <span className={COLOR_VEREDICTO[v.nivel] || COLOR_VEREDICTO.desconocido}>
              {v.texto}
            </span>
            <span className="font-mono text-muted">
              coste {num1(diario.coste)} · objetivo {costeObjetivo.toFixed(1)}
            </span>
          </div>
        </>
      )}

      {repesca.partidas > 0 && (
        <div className="border-t border-white/10 pt-2 text-[10px] text-muted">
          Repesca: <span className="text-white/80">{repesca.partidas}</span> partidas
          {" · "}
          <span className="text-white/80">{repesca.aciertos}</span> aciertos
          {" · "}
          <span className="text-white/80">
            {pct(repesca.aciertos / repesca.partidas)}
          </span>
          <span className="text-muted/70"> — solo registrados, un intento</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Cargar la ficha en EditCarPanel**

En `src/admin/EditCarPanel.jsx`, añade el import junto a los demás de `./`:

```jsx
import FichaRendimiento from "./FichaRendimiento";
```

(Sin extensión: es la convención del fichero — mira los imports de
`./FocusPicker` y `./ZoomBaseField` justo encima.)

Junto a `const [difficulty, setDifficulty] = useState(null);` (línea ~111),
añade:

```jsx
  // Ficha de rendimiento. Va POR SEPARADO del GET del coche a propósito: la
  // sirve /api/admin/car-report leyendo daily_stats en vivo, mientras que
  // `difficulty` sigue saliendo de las columnas cacheadas de cars — que son las
  // que alimentan la sugerencia de zoom. Dos fuentes porque son dos cosas, y
  // porque así la ficha no se cae si el recálculo vuelve a romperse.
  const [ficha, setFicha] = useState(null);
  const [fichaCargando, setFichaCargando] = useState(false);
  const [fichaError, setFichaError] = useState(null);
```

Y un efecto que la pida al cambiar de coche (ponlo justo detrás del efecto que
carga el coche):

```jsx
  useEffect(() => {
    if (!selectedCarId) {
      setFicha(null);
      setFichaError(null);
      return;
    }
    let cancelado = false;
    setFichaCargando(true);
    setFichaError(null);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Sin sesión");
        const res = await fetch(
          `/api/admin/car-report?id=${encodeURIComponent(selectedCarId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        // Mirar res.ok ANTES de parsear: un 504 de Vercel llega como respuesta
        // correcta con HTML dentro, y el .json() reventaría con un SyntaxError
        // que no se parece en nada a la causa (regla 21 del CLAUDE.md).
        if (!res.ok) {
          const cuerpo = await res.json().catch(() => ({}));
          throw new Error(cuerpo?.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!cancelado) setFicha(data);
      } catch (err) {
        if (!cancelado) {
          console.error("[EditCarPanel] car-report:", err);
          setFichaError(err?.message || "Error de red");
          setFicha(null);
        }
      } finally {
        if (!cancelado) setFichaCargando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [selectedCarId]);
```

Comprueba que `supabase` ya esté importado en el fichero; si no, añade
`import { supabase } from "../supabaseClient";`.

- [ ] **Step 3: Montar la ficha y adelgazar DifficultyIntel**

En el JSX, dentro del `<Field label="Nivel de zoom inicial">`, deja
`DifficultyIntel` (sigue sirviendo para la sugerencia de zoom) y añade la ficha
**justo después del cierre de ese `</Field>`**:

```jsx
            <Field label="Rendimiento del coche">
              <FichaRendimiento
                ficha={ficha}
                cargando={fichaCargando}
                error={fichaError}
              />
            </Field>
```

Ahora quita de `DifficultyIntel` lo que la ficha ya dice, para no tener dos
verdades en la misma pantalla. En la función `DifficultyIntel` borra el bloque
de métricas y el veredicto — las tres `<Metric>`, la línea de «Fallo (no
adivinó)» y el cálculo de `verdict`/`verdictClass` con su constante
`TARGET_COST` — y déjala solo con la sugerencia de zoom:

```jsx
// Sugerencia de zoom del bucle de telemetría (DDA Arq. A). Las MÉTRICAS ya no
// están aquí: se las llevó FichaRendimiento, que las lee en vivo. Esto se queda
// solo con lo que sí sale de cars.suggested_zoom_base, que es otra cosa —
// human-in-loop: nada se aplica solo.
function DifficultyIntel({ difficulty, currentZoomBase, onApply, disabled }) {
  const suggestedZoomBase = difficulty?.suggestedZoomBase ?? null;
  if (suggestedZoomBase == null) return null;

  const canApply = Math.abs(suggestedZoomBase - currentZoomBase) >= 0.1;
  if (!canApply) {
    return (
      <p className="mt-2 text-[11px] text-emerald-300/80">
        La telemetría sugiere {suggestedZoomBase.toFixed(1)}×, que es el valor actual.
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onApply?.(suggestedZoomBase)}
      disabled={disabled}
      className="mt-2 self-start rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11px] uppercase tracking-widest text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
    >
      Aplicar sugerencia: {suggestedZoomBase.toFixed(1)}×
    </button>
  );
}
```

Borra también la constante `TARGET_COST` y el componente `Metric` si ya no los
usa nadie más en el fichero (búscalos antes de borrar: `grep -n "TARGET_COST\|<Metric" src/admin/EditCarPanel.jsx`).

- [ ] **Step 4: Verificar**

Run: `npm run build`
Expected: build en verde, sin avisos de import sin usar.

Run: `npm test`
Expected: PASS (incluye `test:estetica`; `src/admin/` está exento, pero el build
de estilos sí se valida).

- [ ] **Step 5: Commit**

```bash
git add src/admin/FichaRendimiento.jsx src/admin/EditCarPanel.jsx
git commit -m "feat(admin): la ficha de rendimiento, con el histograma de intentos

El histograma es lo que justifica la ficha: dos coches con el mismo 82% de
acierto son cosas opuestas si en uno la moda cae en el 1er intento y en otro
en el 5º, y ese matiz no cabe en ningún promedio.

DifficultyIntel se queda solo con la sugerencia de zoom, que es lo único que
de verdad sale de cars.suggested_zoom_base. Tener las métricas en dos sitios
y de dos fuentes distintas era pedir que un día dijeran cosas diferentes."
```

---

## Task 6: Editar abre en el coche de hoy

**Files:**
- Modify: `src/admin/EditCarPanel.jsx`

- [ ] **Step 1: Preseleccionar**

`car-report` sin `id` ya devuelve el coche de hoy, así que no hace falta pedir
el calendario entero. Añade este efecto en `EditCarPanel`, después del de la
ficha:

```jsx
  // Al entrar sin coche elegido, abrir en el de HOY. Es lo que más veces se
  // viene a mirar, y así el panel arranca enseñando algo en vez de un
  // desplegable vacío.
  //
  // Se pide car-report SIN id, que ya resuelve hoy en el servidor: pedir el
  // calendario entero para quedarnos con un campo sería traer catorce días para
  // tirar trece. Silencioso si falla — es una comodidad, no una función: quien
  // no la note seguirá eligiendo a mano.
  useEffect(() => {
    if (selectedCarId) return;
    let cancelado = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        const res = await fetch("/api/admin/car-report", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelado && data?.carId) onSelectCar?.(data.carId);
      } catch {
        // Silencio deliberado: ver arriba.
      }
    })();
    return () => { cancelado = true; };
    // Solo al montar sin selección: si se añade selectedCarId a las deps, al
    // deseleccionar un coche volvería a saltar al de hoy y no se podría vaciar
    // el formulario a propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 2: Verificar**

Run: `npm run build`
Expected: verde.

- [ ] **Step 3: Commit**

```bash
git add src/admin/EditCarPanel.jsx
git commit -m "feat(admin): Editar abre en el coche de hoy

Es lo que más veces se viene a mirar. Se resuelve pidiendo car-report sin id
—que ya devuelve el de hoy— en vez de traerse el calendario de catorce días
para quedarse con un campo.

Falla en silencio a propósito: es una comodidad, y quien no la note seguirá
eligiendo a mano."
```

---

## Task 7: La tabla comparativa, desde la misma fuente

**Files:**
- Modify: `lib/admin-handlers/analytics.js:432-505`
- Modify: `src/admin/AnalyticsPanel.jsx:374-377, 786-822`

El motivo está en el spec: hoy la tabla lee `user_guesses` (solo quien tiene
sesión) y la ficha lee `daily_stats` (todos), así que para el mismo coche dirían
*12 jugadas* y *34* sin explicación visible.

- [ ] **Step 1: Sustituir `fetchHardestCars`**

En `lib/admin-handlers/analytics.js`, reemplaza la función `fetchHardestCars`
entera (desde el comentario `// ---------- Bloque 5` hasta el cierre de la
función) por:

```js
// ---------- Bloque 5: Ficha comparativa de coches ---------------------

// ANTES esto leía user_guesses y contaba SOLO a quien arrastra sesión, mientras
// que la ficha de un coche (FichaRendimiento) lee daily_stats y cuenta a todo
// el mundo. Para el mismo coche la tabla decía «12 jugadas» y la ficha «34», y
// no había forma de saber por qué. Ahora las dos beben de la misma telemetría.
//
// NO depende del `range`: cada coche sale un solo día, así que acotar por
// fechas no afina nada, solo esconde coches. El histórico completo es la vista
// correcta para comparar.
async function fetchCarReports(supabaseAdmin) {
  const { data, error } = await supabaseAdmin.rpc("list_car_reports");
  if (error) {
    console.error("[admin/analytics] list_car_reports:", error.message);
    return [];
  }

  return (data || []).map((r) => {
    const m = derivarMetricas(r);
    return {
      carId: r.car_id,
      marca: r.make || "—",
      modelo: r.model || "—",
      anio: r.year || null,
      emitido: r.aired_on || null,
      plays: m.total,
      losses: m.losses,
      loseRate: m.total > 0 ? m.losses / m.total : null,
      winRate: m.winRate,
      intentoMedio: m.intentoMedio,
      coste: m.coste,
      veredicto: veredicto(m.coste),
    };
  });
}
```

Añade el import arriba, junto a los demás:

```js
import { derivarMetricas, veredicto, COSTE_OBJETIVO } from "./dificultad.js";
```

- [ ] **Step 1b: Retirar la constante duplicada**

`analytics.js` tiene su propia copia del coste objetivo, que es justo lo que la
Tarea 3 venía a terminar. Borra estas dos líneas (~línea 25):

```js
// Objetivo de coste del controlador de dificultad (DDA Arq. A). Réplica del
// default de las RPCs en scripts/2026-06-difficulty-*.sql — mantener en sync.
const DIFFICULTY_TARGET_COST = 3.5;
```

Y en `fetchGlobalDifficulty` (~línea 682) cambia su único uso:

```js
    targetCost: COSTE_OBJETIVO,
```

Comprueba que no queda ninguno: `grep -n "DIFFICULTY_TARGET_COST" lib/admin-handlers/analytics.js`
debe devolver vacío.

- [ ] **Step 2: Cambiar la llamada y la clave del payload**

Busca `fetchHardestCars(supabaseAdmin, fromIso, toIso),` (línea ~880) y
sustitúyelo por:

```js
      fetchCarReports(supabaseAdmin),
```

Busca la variable `hardestCars` en el destructuring del `Promise.all` (~línea
867) y renómbrala a `carReports`. Busca `hardestCars,` en el objeto de respuesta
(~línea 954) y sustitúyelo por:

```js
        carReports,
```

Nota: `fetchCarReports` ya no usa `fromIso`/`toIso`. Si el linter avisa de
variables sin usar en ese `Promise.all`, no las quites del resto de llamadas —
solo de esta.

- [ ] **Step 3: Actualizar la tabla del panel**

En `src/admin/AnalyticsPanel.jsx`, sustituye la ROW 5 (línea ~374):

```jsx
          {/* ROW 5 · Comparativa de coches */}
          <Card title="Coches, de más difícil a más fácil">
            <CarReportsTable cars={data.gameplay.carReports} />
          </Card>
```

Y reemplaza `HardestCarsTable` entera por:

```jsx
// Comparativa de coches. Ordenable porque las tres preguntas son distintas:
// «¿cuál se atragantó?» (fallo), «¿cuál se adivinó de reojo?» (fácil) y «¿cuál
// jugó más gente?» (partidas). Antes solo contestaba la primera, y encima
// contando una población distinta a la de la ficha del coche.
const ORDENES = {
  dificil: { label: "Más difíciles", cmp: (a, b) => (b.coste ?? 0) - (a.coste ?? 0) },
  facil:   { label: "Más fáciles",   cmp: (a, b) => (a.coste ?? 0) - (b.coste ?? 0) },
  jugados: { label: "Más jugados",   cmp: (a, b) => b.plays - a.plays },
};

const COLOR_NIVEL = {
  facil: "text-amber-300",
  dificil: "text-rose-300",
  equilibrado: "text-emerald-300",
  desconocido: "text-muted",
};

function CarReportsTable({ cars }) {
  const [orden, setOrden] = useState("dificil");

  if (!cars || cars.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted">
        Todavía no hay ningún coche con partidas medidas.
      </div>
    );
  }

  const ordenados = [...cars].sort(ORDENES[orden].cmp).slice(0, 25);

  return (
    <>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {Object.entries(ORDENES).map(([clave, { label }]) => (
          <button
            key={clave}
            type="button"
            onClick={() => setOrden(clave)}
            className={`rounded-md border px-2 py-1 text-[10px] uppercase tracking-widest transition ${
              orden === clave
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-white/10 text-muted hover:border-white/20"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <TablaScroll
        minAncho="min-w-[560px]"
        pie={`${cars.length} coches medidos · histórico completo, no el rango de fechas.`}
      >
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-muted">
              <th className="px-3 py-2">Coche</th>
              <th className="px-3 py-2">Año</th>
              <th className="px-3 py-2 text-right">Jugadas</th>
              <th className="px-3 py-2 text-right">% acierto</th>
              <th className="px-3 py-2 text-right">Int. medio</th>
              <th className="px-3 py-2 text-right">Coste</th>
            </tr>
          </thead>
          <tbody>
            {ordenados.map((c) => (
              <tr key={c.carId} className="border-t border-white/5 text-white/85">
                <td className="px-3 py-2">
                  <span className="font-semibold text-white">{c.marca}</span>{" "}
                  <span className="text-white/70">{c.modelo}</span>
                </td>
                <td className="px-3 py-2 text-white/60">{c.anio || "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{c.plays}</td>
                <td className="px-3 py-2 text-right font-mono">{pct(c.winRate)}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {c.intentoMedio == null ? "—" : c.intentoMedio.toFixed(1)}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono ${
                    COLOR_NIVEL[c.veredicto?.nivel] || COLOR_NIVEL.desconocido
                  }`}
                >
                  {c.coste == null ? "—" : c.coste.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TablaScroll>
    </>
  );
}
```

Comprueba que `useState` está en el import de React del fichero (lo está, pero
verifícalo) y que `pct` sigue definido en él.

- [ ] **Step 4: Verificar**

Run: `npm test`
Expected: PASS. Los tests de `analytics.test.js` no tocan `fetchHardestCars`,
así que deben seguir en verde; si alguno falla, has renombrado de más.

Run: `npm run build`
Expected: verde.

- [ ] **Step 5: Commit**

```bash
git add lib/admin-handlers/analytics.js src/admin/AnalyticsPanel.jsx
git commit -m "fix(admin): la tabla de coches contaba una población distinta a la ficha

Leía user_guesses, o sea solo a quien arrastra sesión, mientras que la ficha
lee daily_stats y cuenta a todo el mundo: para el mismo coche una decía 12
jugadas y la otra 34, sin nada que lo explicara. Ahora las dos salen de la
misma telemetría.

De paso deja de acotarse al rango de fechas —cada coche sale un solo día, así
que filtrar por fecha no afina, solo esconde— y se puede ordenar por difícil,
fácil o más jugado, que son tres preguntas distintas."
```

---

## Task 8: Verificación final y PR

- [ ] **Step 1: Suite completa**

```bash
npm test
```
Expected: PASS, incluidos `test:estetica` y los tests nuevos de `dificultad.test.js`.

```bash
npm run test:rls
```
Expected: PASS. Importa de verdad: confirma que las RPCs nuevas **no** son
accesibles desde `anon`/`authenticated`.

```bash
npm run build
```
Expected: verde.

- [ ] **Step 2: Comprobar a mano en el Preview**

Con el Preview de Vercel desplegado, en el panel interno:

1. *Editar* abre con el coche de hoy ya seleccionado.
2. Su ficha muestra el aviso ámbar de «se está jugando ahora mismo».
3. Elegir un coche antiguo enseña histograma, veredicto y, si la tuvo, repesca.
4. Elegir un coche sin estrenar dice «aún no ha salido», sin cifras a cero.
5. *Analítica* → la tabla ordena por los tres criterios y su número de jugadas
   **coincide** con el de la ficha de ese mismo coche. Esta comprobación es la
   que valida la Tarea 7 entera.

- [ ] **Step 3: Abrir el PR**

Regla 13: este cambio va por **PR**, no directo a `main`, y **sin subir
`versionCode`** — el panel nunca se monta en la app (guard de hostname de la
regla 19), así que el jugador no ve nada distinto.

```bash
git push -u origin HEAD
```

Abre el PR de `claude/…` → `main`. En el cuerpo, incluye **qué devolvió el PASO
1 del diagnóstico** (una, dos o cero sobrecargas) y si hubo que dropear alguna:
es la única prueba de que el bug de la dificultad queda cerrado.

Recuerda que hay **SQL que ejecutar a mano** en Supabase antes de que esto
funcione en producción: `scripts/2026-09-ficha-rendimiento-coche.sql`. Dilo en
el PR de forma destacada.
