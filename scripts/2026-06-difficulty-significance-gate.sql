-- 2026-06-difficulty-significance-gate.sql
-- AJUSTE de recompute_car_difficulty para AUDIENCIA PEQUEÑA (~10 jugadores/día).
--
-- PROBLEMA: con ~10 partidas por coche (cada coche sale un solo día), el umbral
-- plano p_min_n=150 del script original NO se alcanza JAMÁS → ninguna sugerencia.
-- Y bajarlo a 10 a secas tampoco vale: 10 muestras son ruido (IC del win-rate
-- ≈ ±30 puntos), así que sugerir por coche en el rango intermedio es adivinar.
--
-- SOLUCIÓN: sustituir el umbral plano por un GATE DE SIGNIFICANCIA. Solo se
-- emite sugerencia cuando el coste observado se desvía del objetivo MÁS ALLÁ
-- DEL RUIDO esperado para ese tamaño de muestra:
--     z = |coste - objetivo| / error_estándar  ≥  p_z_gate
-- A 10 partidas el error estándar es grande, así que solo pasan el gate los
-- coches REALMENTE extremos (p.ej. 9 de 10 perdieron, o 9 de 10 al 1er intento).
-- Esos sí son detectables con poca muestra; el resto se queda en null (honesto).
--
-- Además bajamos el shrinkage (K 50→10): el gate ya hace de filtro de ruido, así
-- que cuando un coche extremo pasa, queremos que el ajuste de base SE MUEVA de
-- verdad en vez de quedar pegado a la media global.
--
-- La varianza se calcula desde la propia distribución de daily_stats (tenemos
-- los counts por intento), no hace falta el detalle por partida.
--
-- Idempotente. Ejecutar en el SQL Editor de Supabase DESPUÉS de
-- 2026-06-difficulty-observatory.sql (reusa sus columnas).

-- La firma cambia (añadimos p_z_gate), así que hay que DROP antes del CREATE:
-- si no, Postgres crearía una segunda sobrecarga y la llamada sin args quedaría
-- ambigua. Borramos la firma de 8 args del script original.
drop function if exists public.recompute_car_difficulty(real, real, real, real, integer, real, real, real);

create or replace function public.recompute_car_difficulty(
  p_target_cost  real    default 3.5,   -- coste objetivo (moda intento 3-4)
  p_loss_penalty real    default 7.0,   -- "coste" de una derrota (> 5)
  p_gain         real    default 0.25,  -- ganancia del controlador (base/punto de error)
  p_shrink_k     real    default 10.0,  -- prior shrinkage (bajado de 50: el gate filtra el ruido)
  p_min_n        integer default 8,     -- piso duro: mínimas partidas para estimar varianza
  p_step_cap     real    default 0.5,   -- ajuste máximo de base por ciclo
  p_z_gate       real    default 1.5,   -- nº de errores estándar para considerar la señal real
  p_zoom_min     real    default 3.2,   -- = ZOOM_BASE_MIN (api/_lib/zoom.js)
  p_zoom_max     real    default 6.0    -- = ZOOM_BASE_MAX (api/_lib/zoom.js)
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
    select
      dc.car_id,
      ds.total_games                                              as n,
      ds.losses,
      (ds.attempt_1 + ds.attempt_2 + ds.attempt_3)::real          as solved_by_3,
      ( (ds.attempt_1 * 1 + ds.attempt_2 * 2 + ds.attempt_3 * 3
         + ds.attempt_4 * 4 + ds.attempt_5 * 5
         + ds.losses * p_loss_penalty)::real
        / nullif(ds.total_games, 0) )                             as cost,
      -- Σ(valorᵢ² · countᵢ): segundo momento, para derivar la varianza del coste.
      ( ds.attempt_1 * 1 + ds.attempt_2 * 4 + ds.attempt_3 * 9
        + ds.attempt_4 * 16 + ds.attempt_5 * 25
        + ds.losses * (p_loss_penalty * p_loss_penalty) )::real   as sumsq
    from public.daily_stats ds
    join public.daily_cars dc on dc.date = ds.date
    where ds.total_games > 0
  ),
  glob as (
    select sum(cost * n) / nullif(sum(n), 0) as gcost from per_car
  ),
  scored as (
    select
      pc.car_id,
      pc.n,
      pc.cost,
      (pc.n * pc.cost + p_shrink_k * g.gcost) / (pc.n + p_shrink_k) as cost_shrunk,
      pc.solved_by_3 / nullif(pc.n, 0)                             as p_by_3,
      pc.losses::real / nullif(pc.n, 0)                            as fail_rate,
      -- Error estándar del coste medio: sqrt(varianza / n). varianza = E[x²]-E[x]²,
      -- acotada a >=0 por seguridad numérica.
      sqrt(greatest(pc.sumsq / nullif(pc.n, 0) - pc.cost * pc.cost, 0) / nullif(pc.n, 0)) as se
    from per_car pc
    cross join glob g
  ),
  final as (
    select
      s.*,
      c.zoom_base as cur_base,
      greatest(-p_step_cap, least(p_step_cap,
        -p_gain * (s.cost_shrunk - p_target_cost)
      )) as delta,
      -- ¿La desviación respecto al objetivo supera el ruido? Si se=0 (todos el
      -- mismo resultado) y el coste no es el objetivo, es una señal consistente
      -- → significativa. Si no, gate por z-score.
      (
        (s.se = 0 and s.cost <> p_target_cost)
        or (s.se > 0 and abs(s.cost - p_target_cost) >= p_z_gate * s.se)
      ) as significant
    from scored s
    join public.cars c on c.id = s.car_id
  )
  update public.cars c set
    difficulty_n           = f.n,
    difficulty_cost        = f.cost,
    difficulty_cost_shrunk = f.cost_shrunk,
    difficulty_p_by_3      = f.p_by_3,
    difficulty_fail_rate   = f.fail_rate,
    -- Sugerencia solo si hay muestra mínima Y la señal es estadísticamente real.
    suggested_zoom_base    = case
      when f.n >= p_min_n and f.significant
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

revoke all on function public.recompute_car_difficulty(real, real, real, real, integer, real, real, real, real) from public;
grant execute on function public.recompute_car_difficulty(real, real, real, real, integer, real, real, real, real) to service_role;

-- ============================================================================
-- get_global_difficulty() — SEÑAL GLOBAL (la fiable a baja escala)
-- ============================================================================
-- A ~10 jugadores/día NO puedes afinar coches sueltos, pero SÍ puedes medir la
-- DERIVA GLOBAL: sumando TODOS los coches, en ~1 mes tienes cientos de partidas
-- → señal robusta de si, en conjunto, tus coches salen fáciles/difíciles. De ahí
-- sale una recomendación para el DEFAULT global de zoom (DEFAULT_ZOOM_BASE 3.7).
--
-- Devuelve una sola fila de agregados de TODA la vida del juego (daily_stats).
create or replace function public.get_global_difficulty(
  p_target_cost  real default 3.5,
  p_loss_penalty real default 7.0,
  p_gain         real default 0.25,
  p_default_base real default 3.7,   -- = DEFAULT_ZOOM_BASE (api/_lib/zoom.js)
  p_zoom_min     real default 3.2,
  p_zoom_max     real default 6.0
)
returns table (
  total_games        bigint,
  cars_measured      bigint,
  cost               real,
  mean_winning_attempt real,
  p_by_3             real,
  fail_rate          real,
  suggested_default_base real
)
language sql
stable
security definer
set search_path = public
as $$
  with agg as (
    select
      sum(total_games)::bigint                          as total_games,
      count(*)::bigint                                  as cars_measured,
      sum(attempt_1 + attempt_2 + attempt_3)::real      as solved_by_3,
      sum(wins)::real                                   as wins,
      sum(losses)::real                                 as losses,
      sum(attempt_1*1 + attempt_2*2 + attempt_3*3
          + attempt_4*4 + attempt_5*5)::real            as sum_win_attempts,
      sum(attempt_1*1 + attempt_2*2 + attempt_3*3
          + attempt_4*4 + attempt_5*5
          + losses*p_loss_penalty)::real                as sum_cost
    from public.daily_stats
    where total_games > 0
  )
  select
    coalesce(a.total_games, 0),
    coalesce(a.cars_measured, 0),
    (a.sum_cost / nullif(a.total_games, 0))::real             as cost,
    (a.sum_win_attempts / nullif(a.wins, 0))::real            as mean_winning_attempt,
    (a.solved_by_3 / nullif(a.total_games, 0))::real          as p_by_3,
    (a.losses / nullif(a.total_games, 0))::real               as fail_rate,
    greatest(p_zoom_min, least(p_zoom_max,
      p_default_base - p_gain * ((a.sum_cost / nullif(a.total_games, 0)) - p_target_cost)
    ))::real                                                  as suggested_default_base
  from agg a;
$$;

revoke all on function public.get_global_difficulty(real, real, real, real, real, real) from public;
grant execute on function public.get_global_difficulty(real, real, real, real, real, real) to service_role;
