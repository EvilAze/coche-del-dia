-- 2026-06-difficulty-observatory.sql
-- ARQUITECTURA A del DDA (Dynamic Difficulty Adjustment): bucle de dificultad
-- por TELEMETRÍA. Mide la dificultad REAL de cada coche a partir de cómo jugó
-- la audiencia y propone un zoom_base corregido. NO aplica nada solo: deja una
-- SUGERENCIA que el admin revisa y aplica con un clic (human-in-loop).
--
-- POR QUÉ daily_stats Y NO user_guesses:
--   El juego es daily → cada fecha = exactamente un coche (daily_cars). Por eso
--   daily_stats (agregado POR FECHA y que cuenta a TODA la audiencia, anónimos
--   incluidos) se atribuye 1:1 a un coche con un JOIN por fecha. user_guesses
--   solo tiene a los logueados (sesgo de jugador enganchado), así que como señal
--   de dificultad global daily_stats es estrictamente mejor.
--
-- CADA COCHE SALE UNA SOLA VEZ como daily, así que esta sugerencia NO re-afina
-- el mismo coche en una próxima jornada (no la hay). Su valor:
--   1) corregir su modo REPESCA (que reusa cars.zoom_base),
--   2) etiquetar datos (features → dificultad observada) para la futura
--      Arquitectura B (visión IA en frío),
--   3) señal de DERIVA global: si todo sale demasiado fácil/difícil, lo ves.
--
-- Coherencia con el motor de zoom: el rango [2.8, 7.5] y el significado de
-- zoom_base son los de api/_lib/zoom.js / src/lib/zoom.js (CLAUDE.md #7). El
-- cron pasa el rango EXPLÍCITO desde esas constantes (warm-daily.js), así que
-- estos defaults solo aplican si ejecutas la función a mano desde el editor.
--
-- ⚠️ NO EJECUTES ESTE FICHERO SUELTO. ESTÁ SUPERSEDIDO.
--   La versión viva de recompute_car_difficulty es la de
--   2026-06-difficulty-significance-gate.sql, que tiene NUEVE argumentos
--   (añade p_z_gate) y dropea la de OCHO que se crea aquí abajo.
--
--   Este fichero decía ser «re-ejecutable sin efectos colaterales» y no lo era:
--   volver a lanzarlo DESPUÉS del gate recrea la sobrecarga de 8 argumentos, y
--   entonces las dos conviven. A partir de ahí, `rpc("recompute_car_difficulty")`
--   sin argumentos deja de poder resolverse:
--
--       ERROR 42725: function public.recompute_car_difficulty() is not unique
--       HINT: Could not choose a best candidate function.
--
--   Eso es lo que pasó de verdad, y como el GET del panel se tragaba el error
--   en silencio, el bloque de dificultad pasó meses diciendo «sin datos» sin
--   que nadie pudiera relacionar el síntoma con la causa. Confirmado el
--   2026-09-05; el arreglo está en 2026-09-arreglo-sobrecarga-dificultad.sql.
--
--   Si necesitas rehacer el observatorio desde cero: ejecuta ESTE fichero y
--   DESPUÉS, siempre, el significance-gate. En ese orden y sin saltarte el
--   segundo.
--
-- Ejecutar una vez en el SQL Editor de Supabase. Las columnas sí son
-- idempotentes (IF NOT EXISTS); la función NO lo es entre ficheros, que es
-- justo lo que costó el disgusto.

-- ============================================================================
-- 1) COLUMNAS DE OBSERVABILIDAD en public.cars
-- ============================================================================
-- Todas ADMIN-ONLY: NO se hace GRANT a anon/authenticated a propósito. Son
-- "intel" de dificultad y /api/list-cars proyecta columnas explícitas (no las
-- pide), así que no necesita el GRANT del CLAUDE.md #3 y no se rompe. El admin
-- las lee con service_role.
alter table public.cars
  add column if not exists difficulty_n          integer,      -- nº de partidas medidas
  add column if not exists difficulty_cost       real,         -- coste medio (1=trivial … 7=imposible)
  add column if not exists difficulty_cost_shrunk real,        -- coste tras shrinkage Empirical Bayes
  add column if not exists difficulty_p_by_3     real,         -- % resuelto en ≤3 intentos
  add column if not exists difficulty_fail_rate  real,         -- % que NO adivinó (perdió)
  add column if not exists suggested_zoom_base   real,         -- zoom_base propuesto (null si pocos datos)
  add column if not exists difficulty_computed_at timestamptz;

comment on column public.cars.difficulty_cost is
  'Coste medio de la partida: (1*a1+2*a2+3*a3+4*a4+5*a5 + LOSS_PENALTY*perdidas)/total. 1=todos ganan al 1er intento, 7=todos pierden. Objetivo ~3.5 (moda intento 3-4). Lo escribe recompute_car_difficulty.';
comment on column public.cars.suggested_zoom_base is
  'zoom_base sugerido por el bucle de telemetría (Arquitectura A DDA). null si difficulty_n < umbral. El admin lo aplica a mano (human-in-loop).';

-- ============================================================================
-- 2) recompute_car_difficulty(...) — el "controlador proporcional"
-- ============================================================================
-- Recalcula la dificultad observada de TODOS los coches que ya tuvieron su día
-- (tienen fila en daily_stats) y deja la sugerencia de zoom_base. Devuelve el
-- nº de coches actualizados.
--
-- MODELO (todo parametrizado para poder afinarlo sin tocar el código):
--   coste por coche = Σ(intento_i * ganados_en_i) + LOSS_PENALTY*perdidas, / N
--     · una derrota "duele" más que llegar al intento 5 → LOSS_PENALTY > 5.
--   shrinkage Empirical Bayes: cost_shrunk = (N*coste + K*coste_global)/(N+K)
--     · coches con pocas partidas se encogen hacia la media → no sobre-reacciona
--       a 30 jugadores de un día flojo.
--   controlador proporcional sobre el zoom_base ACTUAL:
--     error = cost_shrunk - TARGET   (positivo = demasiado difícil)
--     delta = clamp(-GAIN*error, ±STEP_CAP)   (signo: + difícil ⇒ baja base)
--     sugerido = clamp(base + delta, ZOOM_MIN, ZOOM_MAX)
--     · demasiado FÁCIL (error<0) ⇒ delta>0 ⇒ sube base ⇒ empieza más cerrado.
--     · demasiado DIFÍCIL (error>0) ⇒ delta<0 ⇒ baja base ⇒ revela más.
--   solo se emite sugerencia si N >= MIN_N (si no, null: ruido).
--
-- SECURITY DEFINER + service_role: lee daily_cars/daily_stats (bloqueadas al
-- cliente) y escribe cars. Solo la dispara el cron o el admin desde el editor.
create or replace function public.recompute_car_difficulty(
  p_target_cost  real    default 3.5,   -- coste objetivo (moda intento 3-4)
  p_loss_penalty real    default 7.0,   -- "coste" de una derrota (> 5)
  p_gain         real    default 0.25,  -- ganancia del controlador (base/punto de error)
  p_shrink_k     real    default 50.0,  -- fuerza del prior (partidas equivalentes)
  p_min_n        integer default 150,   -- partidas mínimas para emitir sugerencia
  p_step_cap     real    default 0.5,   -- ajuste máximo de base por ciclo
  p_zoom_min     real    default 2.8,   -- = ZOOM_BASE_MIN (api/_lib/zoom.js)
  p_zoom_max     real    default 7.5    -- = ZOOM_BASE_MAX (api/_lib/zoom.js)
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  with per_car as (
    -- Atribuye los agregados del día al coche que tocó ese día.
    select
      dc.car_id,
      ds.total_games                                              as n,
      ds.losses,
      (ds.attempt_1 + ds.attempt_2 + ds.attempt_3)::real          as solved_by_3,
      ( (ds.attempt_1 * 1 + ds.attempt_2 * 2 + ds.attempt_3 * 3
         + ds.attempt_4 * 4 + ds.attempt_5 * 5
         + ds.losses * p_loss_penalty)::real
        / nullif(ds.total_games, 0) )                             as cost
    from public.daily_stats ds
    join public.daily_cars dc on dc.date = ds.date
    where ds.total_games > 0
  ),
  glob as (
    -- Media global PONDERADA por nº de partidas (prior del shrinkage).
    select sum(cost * n) / nullif(sum(n), 0) as gcost from per_car
  ),
  scored as (
    select
      pc.car_id,
      pc.n,
      pc.cost,
      (pc.n * pc.cost + p_shrink_k * g.gcost) / (pc.n + p_shrink_k) as cost_shrunk,
      pc.solved_by_3 / nullif(pc.n, 0)                             as p_by_3,
      pc.losses::real / nullif(pc.n, 0)                            as fail_rate
    from per_car pc
    cross join glob g
  ),
  final as (
    select
      s.*,
      c.zoom_base as cur_base,
      -- delta del controlador, acotado a ±STEP_CAP.
      greatest(-p_step_cap, least(p_step_cap,
        -p_gain * (s.cost_shrunk - p_target_cost)
      )) as delta
    from scored s
    join public.cars c on c.id = s.car_id
  )
  update public.cars c set
    difficulty_n           = f.n,
    difficulty_cost        = f.cost,
    difficulty_cost_shrunk = f.cost_shrunk,
    difficulty_p_by_3      = f.p_by_3,
    difficulty_fail_rate   = f.fail_rate,
    -- Sugerencia solo con muestra suficiente; si no, null (no adivinamos).
    suggested_zoom_base    = case
      when f.n >= p_min_n
        then greatest(p_zoom_min, least(p_zoom_max, f.cur_base + f.delta))
      else null
    end,
    difficulty_computed_at = now()
  from final f
  where c.id = f.car_id;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- Solo el cron (service_role) o el owner desde el SQL editor pueden ejecutarla.
revoke all on function public.recompute_car_difficulty(real, real, real, real, integer, real, real, real) from public;
grant execute on function public.recompute_car_difficulty(real, real, real, real, integer, real, real, real) to service_role;

-- ============================================================================
-- 3) USO MANUAL (read-only para inspeccionar antes de fiarte)
-- ============================================================================
--   -- Recalcular todo (lo hace el cron cada noche):
--   SELECT public.recompute_car_difficulty();
--
--   -- Ver el top de coches "demasiado fáciles" (candidatos a subir base):
--   SELECT make, model, year, zoom_base, suggested_zoom_base,
--          difficulty_n, round(difficulty_cost::numeric,2) AS cost,
--          round(difficulty_p_by_3::numeric,2) AS p_by_3,
--          round(difficulty_fail_rate::numeric,2) AS fail
--   FROM public.cars
--   WHERE suggested_zoom_base IS NOT NULL
--   ORDER BY difficulty_cost ASC
--   LIMIT 20;
