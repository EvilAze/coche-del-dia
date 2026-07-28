-- scripts/2026-07-clasificacion-distancia.sql
-- LA DISTANCIA, NO SOLO EL PUESTO.
--
-- La faja de clasificación enseñaba «7º de 128». Eso sitúa, pero no tira: un
-- puesto es un hecho consumado y no sugiere ninguna acción. Lo que engancha en
-- cualquier clasificación es la DISTANCIA a la fila de arriba — «a 3 puntos del
-- 6º» convierte el dato en un objetivo alcanzable esta misma tarde, y una
-- victoria de hoy vale entre 1 y 10 puntos, así que casi siempre lo es.
--
-- Esto amplía `get_my_season_rank` con tres columnas: mis puntos, los del
-- jugador inmediatamente por delante y la diferencia. Las tres son NULL cuando
-- no aplica (no estoy rankeado, o soy el 1º y no tengo a nadie delante), y el
-- cliente ya trata NULL como "no pintes la línea" — así que una web nueva
-- contra una base de datos sin esta migración sigue funcionando: enseña el
-- puesto y calla la distancia (regla 9, nada se degrada a roto).
--
-- NO toca el cálculo de puntos: se limita a leer get_season_leaderboard, que
-- sigue siendo la única fuente de verdad de la puntuación (ver
-- scripts/2026-07-temporadas.sql — no diverjas de ahí).
--
-- Aplicar en el SQL editor de Supabase. Idempotente.

-- ============================================================================
-- get_my_season_rank(p_user_id, p_season_id) — ahora con la distancia al de arriba
-- ============================================================================
-- La firma (uuid, uuid) NO cambia, así que el DROP es solo por el RETURNS TABLE
-- ampliado (Postgres no deja cambiar el tipo de retorno con CREATE OR REPLACE).
DROP FUNCTION IF EXISTS public.get_my_season_rank(uuid, uuid);
CREATE OR REPLACE FUNCTION public.get_my_season_rank(
  p_user_id uuid,
  p_season_id uuid DEFAULT NULL
)
RETURNS TABLE (
  rank int, total int, prev_rank int, delta int,
  points int,      -- mis puntos en la temporada
  next_points int, -- los del jugador justo por delante (NULL si soy 1º)
  gap int          -- next_points - points (siempre >= 0; NULL si soy 1º)
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH lb AS (
    -- Una sola pasada del leaderboard: de aquí salen mi fila, el total y —vía
    -- LAG— los puntos del que tengo justo encima. Traer la tabla entera al
    -- cliente para calcular esto sería justo lo que la RPC evita.
    SELECT
      slb.rank, slb.user_id, slb.total_points,
      LAG(slb.total_points) OVER (ORDER BY slb.rank) AS above_points
    FROM public.get_season_leaderboard(p_season_id, 1000000) slb
  ),
  me AS (
    SELECT
      (SELECT lb.rank         FROM lb WHERE lb.user_id = p_user_id)::int AS rank,
      (SELECT count(*)        FROM lb)::int                              AS total,
      (SELECT lb.total_points FROM lb WHERE lb.user_id = p_user_id)::int AS points,
      (SELECT lb.above_points FROM lb WHERE lb.user_id = p_user_id)::int AS next_points
  ),
  prev AS (
    SELECT rs.rank AS prev_rank
    FROM public.rank_snapshots rs
    WHERE rs.user_id = p_user_id
      AND rs.day = (now() AT TIME ZONE 'Europe/Madrid')::date
    LIMIT 1
  )
  SELECT
    me.rank, me.total, prev.prev_rank,
    CASE WHEN me.rank IS NOT NULL AND prev.prev_rank IS NOT NULL
         THEN prev.prev_rank - me.rank ELSE NULL END AS delta,
    me.points,
    me.next_points,
    -- GREATEST(0, …) por prudencia: con empate a puntos el de arriba puede tener
    -- los MISMOS (el desempate es por fecha de última victoria), y «a -0 puntos»
    -- no significa nada. 0 = «empatado, te separa el desempate».
    CASE WHEN me.next_points IS NOT NULL AND me.points IS NOT NULL
         THEN GREATEST(0, me.next_points - me.points) ELSE NULL END AS gap
  FROM me LEFT JOIN prev ON true;
$$;
REVOKE ALL ON FUNCTION public.get_my_season_rank(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_season_rank(uuid, uuid) TO anon, authenticated;
