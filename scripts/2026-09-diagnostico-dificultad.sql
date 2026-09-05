-- DIAGNÓSTICO: por qué cars.difficulty_n está a NULL.
-- Pegar entero en el SQL Editor de Supabase. Solo el PASO 4 escribe, y es
-- exactamente la operación que el panel ya intenta hacer en cada GET.

-- PASO 1 · ¿Cuántas sobrecargas de recompute_car_difficulty existen?
--   0 filas  -> la función no existe: el panel llama al vacío.
--   1 fila   -> bien.
--   2 filas  -> AMBIGÜEDAD: llamarla sin argumentos falla siempre (PGRST203).
select
  p.oid::regprocedure as firma,
  pg_get_function_identity_arguments(p.oid) as argumentos
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'recompute_car_difficulty';

-- PASO 2 · ¿Hay telemetría de la que partir?
select
  count(*)                as dias_con_stats,
  sum(total_games)        as partidas_totales,
  min(date)               as primer_dia,
  max(date)               as ultimo_dia
from public.daily_stats
where total_games > 0;

-- PASO 3 · ¿El JOIN por fecha encuentra pareja? Este es el corazón del cálculo.
--   Si "dias_emparejados" es 0 pero el PASO 2 daba partidas, el problema es
--   que daily_cars y daily_stats no casan por fecha.
select
  count(*) as dias_emparejados,
  sum(ds.total_games) as partidas_atribuibles,
  count(distinct dc.car_id) as coches_medibles
from public.daily_stats ds
join public.daily_cars dc on dc.date = ds.date
where ds.total_games > 0;

-- PASO 4 · Ejecutar el recálculo A MANO y ver qué contesta.
--   Devuelve el nº de coches actualizados. Si aquí salta un ERROR, ese error
--   es justo el que el panel se está tragando en silencio.
select public.recompute_car_difficulty() as coches_actualizados;

-- PASO 5 · ¿Quedó escrito?
select
  count(*) filter (where difficulty_n is not null) as con_dificultad,
  count(*) filter (where suggested_zoom_base is not null) as con_sugerencia,
  count(*) as coches_totales,
  max(difficulty_computed_at) as ultimo_calculo
from public.cars;
