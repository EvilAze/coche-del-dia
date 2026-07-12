-- scripts/2026-07-temporadas-flip.sql
-- FASE 2: el "flip" de scope mensual → temporada en el lado servidor.
--   (a) current_season() pasa a RETURNS SETOF: sin temporada activa devuelve CERO
--       filas en vez de una fila toda-NULL (más limpio; get_season_leaderboard se
--       comporta igual — el subselect da NULL y el leaderboard sale vacío).
--   (b) snapshot_daily_ranks() sella el "movimiento vs ayer" contra el leaderboard
--       de TEMPORADA (antes mensual). rank_snapshots se reutiliza intacta.
-- Aplicar en el SQL editor de Supabase DESPUÉS de scripts/2026-07-temporadas.sql.

-- (a) current_season() → SETOF (cambia el tipo de retorno: requiere DROP previo).
--     get_season_leaderboard la referencia por nombre; PG no crea dependencia
--     dura entre funciones SQL, así que el DROP no rompe el leaderboard.
DROP FUNCTION IF EXISTS public.current_season();
CREATE OR REPLACE FUNCTION public.current_season()
RETURNS SETOF public.seasons
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT * FROM public.seasons
  WHERE (now() AT TIME ZONE 'Europe/Madrid')::date BETWEEN starts_at AND ends_at
  ORDER BY starts_at DESC
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.current_season() TO anon, authenticated;

-- (b) snapshot_daily_ranks() → scope temporada. Única línea que cambia respecto a
-- scripts/supabase-rank-movement.sql: la fuente del snapshot. El día 1 de una
-- temporada nueva el leaderboard está vacío → snapshot vacío → prev_rank NULL →
-- copy neutro ("estrenas puesto"). Reset correcto sin código extra.
CREATE OR REPLACE FUNCTION public.snapshot_daily_ranks()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_day date := (now() AT TIME ZONE 'Europe/Madrid')::date; v_n int;
BEGIN
  DELETE FROM public.rank_snapshots WHERE day = v_day;
  INSERT INTO public.rank_snapshots (day, user_id, rank)
  SELECT v_day, lb.user_id, lb.rank
  FROM public.get_season_leaderboard(NULL, 1000000) lb;   -- ← antes get_monthly_leaderboard
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END; $$;
