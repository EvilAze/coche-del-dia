-- scripts/2026-07-pick-daily-car-borradores.sql
-- Versión DEFINITIVA de pick_daily_car. Supersede la de
-- scripts/2026-07-temporadas-tematicas.sql (bloque [4]) y hace dos cosas:
--
--   1. Gana un flag OPCIONAL para permitir coches sin foto (image_ready=FALSE)
--      en el sorteo, para montar una temporada temática "al vuelo".
--   2. ELIMINA el paso 2b (repetir un coche del tema). Ver más abajo: era un
--      paso imposible, y en producción puso el mismo coche hoy y mañana.
--
-- Aplicar en el SQL editor de Supabase DESPUÉS de
-- scripts/2026-07-temporadas-tematicas.sql. Idempotente.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ MUERE EL PASO 2b
-- ---------------------------------------------------------------------------
-- La versión anterior tenía un escalón intermedio: si se agotaban los coches
-- del tema sin estrenar, repetía el del tema que llevara más tiempo sin salir,
-- con el argumento de que "un repetido decepciona, pero romper la temática
-- rompe la promesa". Ese argumento estaba mal, por dos motivos.
--
-- El práctico: con un pool de un solo coche, ese "el que lleva más tiempo sin
-- salir" es el coche de HOY, así que mañana salía otra vez el mismo. Repetir un
-- coche de hace tres meses se tolera; repetir el de hoy mañana es indefendible.
--
-- El de fondo, que es el que debí ver antes de escribirlo: este código asume
-- **un coche = un solo día**. lib/admin-handlers/schedule.js hace
-- `.eq("car_id", carId).maybeSingle()` para localizar la fecha de un coche, y
-- eso revienta en cuanto un coche está en dos fechas. Bajo esa invariante, 2b
-- solo podía devolver coches YA asignados — es decir, sus únicas salidas
-- posibles eran todas inválidas. Y "del tema y sin asignar" es literalmente el
-- paso 2a. 2b nunca tuvo un caso legítimo.
--
-- Consecuencia asumida: si el pool del tema no llega a los días de la
-- temporada, la temática SE ROMPE esos días (caen al paso 3, catálogo general)
-- en vez de repetir. Es lo correcto: el aviso de pool del panel de Temporadas
-- existe justo para que no se llegue a ese caso, y ahora dice la verdad.
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
-- Escalera final:
--   1) Día ya fijado en daily_cars       → manda (incluye el Calendario admin)
--   2) Coche DEL TEMA sin estrenar       → el caso normal en temporada
--   3) Coche cualquiera sin estrenar     → sin tema, o pool del tema agotado
--   4) Coche cualquiera al azar          → catálogo entero agotado
--
-- Ningún paso puede devolver un coche ya asignado salvo el 4, que es el fondo
-- de saco preexistente para "no quedan coches en el catálogo".

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

  -- 2) Coches del tema que NUNCA han salido. Si no queda ninguno, NO se repite
  --    dentro del tema: se cae al paso 3 (ver la cabecera de este archivo —
  --    repetir violaría la invariante "un coche = un solo día" del calendario).
  if v_filter is not null and v_filter <> '{}'::jsonb then
    select c.id into v_car_id
    from cars c
    where (p_allow_drafts or c.image_ready = true)
      and car_matches_theme(c.tags, c.pais, c.make, c.year, v_filter)
      and not exists (select 1 from daily_cars dc where dc.car_id = c.id)
    order by random()
    limit 1;
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
--
-- c) LIMPIEZA de los duplicados que dejó el paso 2b antes de morir. Un coche en
--    dos fechas rompe el swap del calendario (schedule.js localiza la fecha de
--    un coche con `.eq("car_id", …).maybeSingle()`, que falla con dos filas).
--    Esta consulta los lista:
--
-- SELECT dc.car_id, c.make, c.model, count(*) AS veces,
--        array_agg(dc.date ORDER BY dc.date) AS fechas
-- FROM daily_cars dc
-- JOIN cars c ON c.id = dc.car_id
-- GROUP BY dc.car_id, c.make, c.model
-- HAVING count(*) > 1;
--
--    NO hace falta SQL para arreglarlo: pulsa «Liberar días futuros» en el
--    panel. Al liberar y re-sortear, el duplicado futuro desaparece y el paso 2
--    ya no puede volver a crearlo. Solo usa un DELETE manual si el duplicado
--    está en fechas PASADAS (y entonces piénsalo dos veces: es histórico).
