-- scripts/2026-07-temporadas-tematicas.sql
-- LA TEMÁTICA SE HACE REAL. Hasta ahora `seasons` era number + label + fechas:
-- el banner anunciaba «Temporada 7: Grupo B» pero pick_daily_car sorteaba entre
-- TODO el catálogo. La temática solo se cumplía si el admin cuadraba los coches
-- a mano en el Calendario de 14 días — y el día que no cuadrara, el jugador
-- descubría que el nombre era decoración. Esto cierra esa promesa: el sorteo
-- del día se restringe al pool que casa con el filtro de la temporada.
--
-- Aplicar en el SQL editor de Supabase, DESPUÉS de 2026-07-temporadas.sql y
-- 2026-07-temporadas-flip.sql. Idempotente (IF NOT EXISTS / CREATE OR REPLACE).
--
-- QUÉ TOCA:
--   [1] cars.tags            — etiquetas curadas (NO legibles por el cliente)
--   [2] seasons.theme_filter — el filtro, con grants por columna (NO público)
--   [3] car_matches_theme()  — predicado puro filtro↔coche
--   [4] pick_daily_car()     — ⚠️ ÚNICO bloque que reemplaza lógica viva
--   [5] season_pool_stats()  — cuántos coches cubre un filtro (preview admin)
--
-- REGLA 9 (no degradar): una temporada sin filtro, con filtro vacío o con un
-- filtro mal montado que no casa con NINGÚN coche cae al comportamiento
-- histórico. El juego diario nunca se rompe por una temática mal configurada.


-- ============================================================================
-- [1] cars.tags — etiquetas curadas
-- ============================================================================
-- Para temas que NO se deducen de los datos. «Coches alemanes» o «Los 80»
-- salen gratis de pais/year; «Grupo B» —el placeholder que usa el propio panel
-- de temporadas— no: eso hay que curarlo a mano, coche a coche.
ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

-- ⚠️ AQUÍ NO VA UN «GRANT SELECT (tags)», Y ES DELIBERADO.
--
-- La regla 3 de CLAUDE.md dice que toda columna nueva de `cars` necesita
-- GRANT SELECT a anon/authenticated o /api/list-cars rompe. Esta es la
-- excepción, y el motivo es la regla 5 (no filtrar la identidad del coche):
-- si `tags` fuera legible, el cliente podría cruzar el catálogo público con la
-- temática y reducir el coche del día a la lista exacta de candidatos. El tema
-- se comunica en prosa («Grupo B»); el pool exacto se queda en el servidor.
--
-- No rompe nada porque /api/list-cars selecciona columnas explícitas
-- ("id, make, model, year, pais, image_ready") y NO pide tags. El panel admin
-- las lee por /api/admin/save-car, que va con service_role y se salta RLS.
-- Si algún día añades `tags` a una query del cliente, romperá con
-- «permission denied» — y ese fallo ruidoso es exactamente lo que queremos.

-- GIN: el operador de solape (&&) sobre arrays lo aprovecha. Con ~400 coches
-- es irrelevante, pero pick_daily_car lo consulta en CADA primer hit del día
-- y el índice es barato.
CREATE INDEX IF NOT EXISTS cars_tags_gin_idx ON public.cars USING gin (tags);


-- ============================================================================
-- [2] seasons.theme_filter — el filtro
-- ============================================================================
-- Forma (AND entre claves, OR dentro de cada lista). Documentada y validada
-- en api/_lib/season-theme.js, que es la única autoridad de escritura:
--
--   {"tags":["grupo-b"]}
--   {"pais":["Italia"],"year_from":1980,"year_to":1989}
--   {"make":["Ferrari"]}
--
-- NULL = temporada sin temática (comportamiento histórico). Es el default.
ALTER TABLE public.seasons
  ADD COLUMN IF NOT EXISTS theme_filter jsonb;

-- El filtro NO es público. `seasons` tenía un GRANT SELECT a nivel de TABLA,
-- lo que expondría theme_filter al cliente en cuanto exista la columna — y un
-- filtro legible es el pool del día enumerable (mismo razonamiento que tags).
-- Pasamos a grants por COLUMNA, igual que ya hace `cars` desde el hardening.
--
-- Seguro para el cliente: statsService.getCurrentSeason() pide
-- (id, number, label_es, label_en, starts_at, ends_at) y el embed de
-- season_podium pide (number, label_es, label_en, ends_at) — todas concedidas
-- abajo. Ninguna query del front hace select("*") sobre seasons (verificado).
REVOKE SELECT ON public.seasons FROM anon, authenticated;
GRANT SELECT (id, number, label_es, label_en, starts_at, ends_at, closed_at, created_at)
  ON public.seasons TO anon, authenticated;


-- ============================================================================
-- [3] car_matches_theme() — ¿este coche pertenece a esta temática?
-- ============================================================================
-- Predicado PURO (no toca tablas) → IMMUTABLE, y el planner puede llamarlo por
-- fila sin penalización. Separado de pick_daily_car para poder probar un filtro
-- en el SQL editor antes de programar la temporada, y para que season_pool_stats
-- use exactamente el mismo criterio que el sorteo (si divergieran, el preview
-- del admin mentiría).
--
-- Case-insensitive a propósito: 'italia' e 'Italia' son el mismo país. El
-- catálogo se ha rellenado a mano durante meses y la capitalización no es
-- fiable; que un tema falle por una mayúscula sería el peor tipo de bug —
-- silencioso y solo visible como «hoy salió un coche que no pinta nada».
--
-- Comprobamos la presencia de cada clave con `->` IS NULL en vez del operador
-- `?`: hace lo mismo y evita el interrogante, que algunos drivers y editores
-- interpretan como marcador de parámetro.
--
-- ESTA FUNCIÓN NO PUEDE LANZAR NUNCA. Se evalúa dentro del WHERE de
-- pick_daily_car, así que una excepción aquí no rompe una temporada: rompe el
-- juego diario entero (regla 9). Por eso cada clave se valida con jsonb_typeof
-- antes de desestructurarla — un `{"tags": null}` o un `{"year_from": "mil"}`
-- metidos a mano por SQL harían reventar a jsonb_array_elements_text y al cast
-- ::int respectivamente. Con el guard, un filtro malformado simplemente no casa
-- con ningún coche: el pool queda a cero, pick_daily_car cae al catálogo
-- completo y el preview del panel lo canta con un «ningún coche casa».
-- Fallar hacia "sin temática" es degradar; fallar con excepción es caerse.
CREATE OR REPLACE FUNCTION public.car_matches_theme(
  p_tags   text[],
  p_pais   text,
  p_make   text,
  p_year   int,
  p_filter jsonb
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT
    -- Sin filtro = casa con todo. Es el camino de la temporada sin temática.
    p_filter IS NULL
    OR p_filter = '{}'::jsonb
    OR (
      -- tags: solape entre las etiquetas del coche y las del filtro.
      (p_filter->'tags' IS NULL OR (
        jsonb_typeof(p_filter->'tags') = 'array' AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(p_filter->'tags') AS f(v)
          WHERE lower(f.v) = ANY (
            SELECT lower(t) FROM unnest(COALESCE(p_tags, '{}'::text[])) AS t
          )
        )
      ))
      -- pais / make: pertenencia a la lista.
      AND (p_filter->'pais' IS NULL OR (
        jsonb_typeof(p_filter->'pais') = 'array' AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(p_filter->'pais') AS f(v)
          WHERE lower(f.v) = lower(COALESCE(p_pais, ''))
        )
      ))
      AND (p_filter->'make' IS NULL OR (
        jsonb_typeof(p_filter->'make') = 'array' AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(p_filter->'make') AS f(v)
          WHERE lower(f.v) = lower(COALESCE(p_make, ''))
        )
      ))
      -- Rango de año. Los COALESCE hacen que un coche con year NULL NUNCA
      -- entre en una temática acotada por años (-1 nunca es >= 1980), en vez
      -- de colarse por la puerta de atrás de una comparación con NULL.
      AND (p_filter->'year_from' IS NULL OR (
        jsonb_typeof(p_filter->'year_from') = 'number'
        AND COALESCE(p_year, -1) >= (p_filter->>'year_from')::int
      ))
      AND (p_filter->'year_to' IS NULL OR (
        jsonb_typeof(p_filter->'year_to') = 'number'
        AND COALESCE(p_year, 99999) <= (p_filter->>'year_to')::int
      ))
    );
$function$;

-- Nadie la llama desde el cliente: es un detalle del sorteo. Dejarla ejecutable
-- por anon permitiría sondear el catálogo filtro a filtro.
REVOKE EXECUTE ON FUNCTION public.car_matches_theme(text[], text, text, int, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.car_matches_theme(text[], text, text, int, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.car_matches_theme(text[], text, text, int, jsonb) FROM authenticated;


-- ============================================================================
-- [4] pick_daily_car() — ⚠️ REEMPLAZA LÓGICA VIVA. Léelo dos veces.
-- ============================================================================
-- Conserva ÍNTEGRA la versión anterior (2026-05-batch-200-cars.sql [PASO 2]):
-- camino feliz por daily_cars, filtro image_ready en todos los SELECT, lock por
-- INSERT ... ON CONFLICT y re-lectura tras perder la carrera. Lo único nuevo es
-- la escalera temática de los pasos 2a/2b, que se salta entera si no hay tema.
--
-- ESCALERA (de más a menos deseable):
--   1)  Día ya fijado en daily_cars           → manda (incluye el Calendario admin)
--   2a) Coche DEL TEMA que nunca ha salido    → el caso normal en temporada
--   2b) Coche DEL TEMA menos reciente         → pool temático agotado
--   3)  Coche cualquiera que nunca ha salido  → sin tema / tema vacío
--   4)  Coche cualquiera al azar              → catálogo agotado
--
-- Por qué 2b va ANTES que 3: si el pool del tema se agota a mitad de temporada,
-- repetir un coche del tema es mejor experiencia que colar un utilitario en
-- plena semana de Grupo B. Un repetido decepciona; romper la temática rompe la
-- promesa, que es justo lo que veníamos a arreglar. El admin tiene el preview
-- de pool en el panel para no llegar nunca a este caso.
CREATE OR REPLACE FUNCTION public.pick_daily_car(p_date date)
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
  -- precalienta días futuros, y ese día puede caer en la temporada siguiente:
  -- usar now() aquí haría que el primer día de cada temporada saliera con el
  -- tema de la anterior.
  select s.theme_filter into v_filter
  from seasons s
  where p_date between s.starts_at and s.ends_at
  order by s.starts_at desc
  limit 1;

  if v_filter is not null and v_filter <> '{}'::jsonb then
    -- 2a) Coches del tema que NUNCA han salido.
    select c.id into v_car_id
    from cars c
    where c.image_ready = true
      and car_matches_theme(c.tags, c.pais, c.make, c.year, v_filter)
      and not exists (select 1 from daily_cars dc where dc.car_id = c.id)
    order by random()
    limit 1;

    -- 2b) Pool temático agotado: el del tema que lleva MÁS tiempo sin salir.
    --     `nulls first` es defensivo — un coche sin fila en daily_cars no
    --     debería llegar aquí (lo habría cogido 2a), pero si llega, gana.
    if v_car_id is null then
      select c.id into v_car_id
      from cars c
      where c.image_ready = true
        and car_matches_theme(c.tags, c.pais, c.make, c.year, v_filter)
      order by
        (select max(dc.date) from daily_cars dc where dc.car_id = c.id) asc nulls first,
        random()
      limit 1;
    end if;
  end if;

  -- 3) Sin temporada, sin temática, o temática que no casa con NINGÚN coche.
  --    Comportamiento histórico intacto.
  if v_car_id is null then
    select c.id into v_car_id
    from cars c
    where c.image_ready = true
      and not exists (select 1 from daily_cars dc where dc.car_id = c.id)
    order by random()
    limit 1;
  end if;

  -- 4) Catálogo agotado: mejor un repetido con imagen que un 500.
  if v_car_id is null then
    select id into v_car_id
    from cars
    where image_ready = true
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

-- Re-aplicar las revocaciones del hardening (CREATE OR REPLACE resetea ACLs).
REVOKE EXECUTE ON FUNCTION public.pick_daily_car(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pick_daily_car(date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pick_daily_car(date) FROM authenticated;


-- ============================================================================
-- [5] season_pool_stats() — el preview que evita temporadas imposibles
-- ============================================================================
-- Responde «¿cuántos coches cubre este filtro y cuántos no han salido nunca?».
-- Es la red de seguridad operativa: el panel la llama mientras editas y avisa
-- si el pool no da para los días de la temporada, ANTES de programarla. Sin
-- esto, un tema demasiado estrecho se descubre a mitad de temporada, repitiendo
-- coches en producción.
--
-- Usa car_matches_theme, el MISMO predicado que el sorteo: el número que ve el
-- admin es exactamente el pool del que tirará pick_daily_car.
CREATE OR REPLACE FUNCTION public.season_pool_stats(p_filter jsonb)
RETURNS TABLE (total int, unseen int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    count(*)::int AS total,
    count(*) FILTER (
      WHERE NOT EXISTS (SELECT 1 FROM daily_cars dc WHERE dc.car_id = c.id)
    )::int AS unseen
  FROM cars c
  WHERE c.image_ready = true
    AND car_matches_theme(c.tags, c.pais, c.make, c.year, p_filter);
$function$;

-- Solo el servicio. Expuesta al cliente sería un oráculo para acotar el coche
-- del día: bastaría probar filtros hasta estrechar el pool a un puñado.
REVOKE EXECUTE ON FUNCTION public.season_pool_stats(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.season_pool_stats(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.season_pool_stats(jsonb) FROM authenticated;


-- ============================================================================
-- [6] VERIFICACIÓN (read-only). Ejecuta esto después de aplicar lo de arriba.
-- ============================================================================
-- a) El filtro casa con lo que esperas. Cambia el jsonb y mira la lista:
--
-- SELECT make, model, year, pais, tags
-- FROM cars
-- WHERE image_ready = true
--   AND car_matches_theme(tags, pais, make, year, '{"pais":["Italia"],"year_from":1980,"year_to":1989}'::jsonb)
-- ORDER BY year;
--
-- b) El pool da para la temporada (total ≥ días, unseen idealmente ≥ días):
--
-- SELECT * FROM season_pool_stats('{"tags":["grupo-b"]}'::jsonb);
--
-- c) theme_filter NO es legible por el cliente. Con la anon key debe fallar
--    con «permission denied for column theme_filter»:
--
-- SELECT id, theme_filter FROM seasons LIMIT 1;
--
-- d) Etiquetar coches (ejemplo). Las etiquetas son slugs en minúscula —
--    api/_lib/season-theme.js normaliza a minúsculas y el match es
--    case-insensitive, pero mantener el dato limpio ahorra sorpresas:
--
-- UPDATE cars SET tags = array_append(tags, 'grupo-b')
-- WHERE make = 'Lancia' AND model = 'Delta S4' AND NOT ('grupo-b' = ANY(tags));
