-- scripts/2026-07-pick-daily-car-borradores.sql
-- pick_daily_car gana un flag OPCIONAL para permitir coches sin foto
-- (image_ready = FALSE) en el sorteo. Sirve para montar una temporada temática
-- "al vuelo": el admin programa los 14 días con coches del tema aunque todavía
-- no tengan imagen, y va subiendo las fotos antes de que llegue cada día.
--
-- Aplicar en el SQL editor de Supabase DESPUÉS de
-- scripts/2026-07-temporadas-tematicas.sql. Idempotente.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ UN FLAG Y NO QUITAR EL FILTRO
-- ---------------------------------------------------------------------------
-- Un coche sin foto como coche del día NO es una degradación: /api/daily-image
-- no tiene nada que servir y la jornada queda injugable para todo el mundo. El
-- filtro `image_ready` existe justo para eso (lo añadió el batch de 200 coches).
--
-- Por eso el flag es OPT-IN y su default es FALSE:
--   · pick_daily_car(p_date)        → como siempre. Es lo que llaman
--     get-daily-car, validate-guess, daily-image, garage, warm-daily y health.
--     Ninguno cambia, y ninguno puede sacar un borrador ni por accidente.
--   · pick_daily_car(p_date, true)  → solo lo llama la acción "liberar e
--     incluir borradores" del panel admin, que es un acto deliberado.
--
-- La firma vieja se DROPea y se recrea con el parámetro por defecto. Sin el
-- DROP, Postgres tendría dos candidatas y la llamada de un argumento fallaría
-- con «function is not unique».
--
-- El resto del cuerpo es idéntico al de 2026-07-temporadas-tematicas.sql: misma
-- escalera (día fijado → tema sin estrenar → tema menos reciente → histórico),
-- mismo lock, misma re-lectura. Lo único que cambia es que las cuatro
-- condiciones de `image_ready` pasan a ser «(p_allow_drafts OR image_ready)».

DROP FUNCTION IF EXISTS public.pick_daily_car(date);

CREATE OR REPLACE FUNCTION public.pick_daily_car(
  p_date date,
  p_allow_drafts boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_car_id uuid;
  v_filter jsonb;
begin
  -- 1) Camino feliz: ya hay coche fijado para este día.
  select car_id into v_car_id from daily_cars where date = p_date;
  if v_car_id is not null then
    return v_car_id;
  end if;

  -- Temática de la temporada que CONTIENE p_date — no la de "hoy". warm-daily
  -- precalienta días futuros, y ese día puede caer en la temporada siguiente.
  select s.theme_filter into v_filter
  from seasons s
  where p_date between s.starts_at and s.ends_at
  order by s.starts_at desc
  limit 1;

  if v_filter is not null and v_filter <> '{}'::jsonb then
    -- 2a) Coches del tema que NUNCA han salido.
    select c.id into v_car_id
    from cars c
    where (p_allow_drafts or c.image_ready = true)
      and car_matches_theme(c.tags, c.pais, c.make, c.year, v_filter)
      and not exists (select 1 from daily_cars dc where dc.car_id = c.id)
    order by random()
    limit 1;

    -- 2b) Pool temático agotado: el del tema que lleva MÁS tiempo sin salir.
    if v_car_id is null then
      select c.id into v_car_id
      from cars c
      where (p_allow_drafts or c.image_ready = true)
        and car_matches_theme(c.tags, c.pais, c.make, c.year, v_filter)
      order by
        (select max(dc.date) from daily_cars dc where dc.car_id = c.id) asc nulls first,
        random()
      limit 1;
    end if;
  end if;

  -- 3) Sin temporada, sin temática, o temática que no casa con NINGÚN coche.
  if v_car_id is null then
    select c.id into v_car_id
    from cars c
    where (p_allow_drafts or c.image_ready = true)
      and not exists (select 1 from daily_cars dc where dc.car_id = c.id)
    order by random()
    limit 1;
  end if;

  -- 4) Catálogo agotado: mejor un repetido con imagen que un 500.
  if v_car_id is null then
    select id into v_car_id
    from cars
    where (p_allow_drafts or image_ready = true)
    order by random()
    limit 1;
  end if;

  if v_car_id is null then
    raise exception 'No cars in catalog';
  end if;

  -- 5) Lock: si dos requests llegan a la vez, gana el primero que inserta.
  insert into daily_cars (date, car_id)
  values (p_date, v_car_id)
  on conflict (date) do nothing;

  -- 6) Releer por si perdimos la carrera contra otro request concurrente.
  select car_id into v_car_id from daily_cars where date = p_date;
  return v_car_id;
end;
$function$;

-- Re-aplicar las revocaciones del hardening. CREATE OR REPLACE resetea ACLs, y
-- además la firma es nueva (2 args): sus permisos empiezan de cero. Si esto no
-- se aplica, cualquiera con la anon key podría llamar a la RPC y —peor— pasarle
-- p_allow_drafts para fijar borradores.
REVOKE EXECUTE ON FUNCTION public.pick_daily_car(date, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pick_daily_car(date, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pick_daily_car(date, boolean) FROM authenticated;


-- ============================================================================
-- VERIFICACIÓN (read-only)
-- ============================================================================
-- a) Solo debe existir UNA pick_daily_car, con dos argumentos y el default:
--
-- SELECT pg_get_function_identity_arguments(oid) AS args,
--        pg_get_function_arguments(oid)          AS args_con_default,
--        proacl
-- FROM pg_proc
-- WHERE proname = 'pick_daily_car'
--   AND pronamespace = 'public'::regnamespace;
--
--    Si salen DOS filas, el DROP no se aplicó y las llamadas de un argumento
--    van a fallar con «function is not unique». Borra la de un solo argumento.
--
-- b) `proacl` NO debe incluir anon ni authenticated. Si sale NULL, quiere decir
--    que están los defaults de Postgres (EXECUTE para PUBLIC) → vuelve a correr
--    los tres REVOKE de arriba.
