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
