-- scripts/2026-09-ranking-semanal.sql
-- RANKING SEMANAL COMO FALLBACK ENTRE TEMPORADAS
--
-- Añade una función current_week_range() que calcula periodos de 7 días cuando
-- no hay temporada activa, basándose en la fecha de fin de la última temporada
-- (o por semanas naturales si nunca hubo temporadas).
-- Modifica get_season_leaderboard() para caer a ese rango de fechas cuando
-- no se pide una temporada y current_season() no encuentra nada. De esta forma,
-- los jugadores tienen un ranking corto que competir mientras empieza la nueva.
-- Incluye get_current_week_range() como RPC para el frontend.
--
-- Idempotente. Aplicar en el editor de Supabase.

-- ============================================================================
-- [1] current_week_range() - Lógica del cálculo semanal
-- ============================================================================
-- Calcula una ventana de 7 días para el ranking cuando estamos en "limbo".
-- Si la última temporada acabó un martes, las semanas de limbo van de
-- miércoles a martes. Si no ha habido temporadas nunca, usamos las semanas
-- de calendario estándar de Madrid (lunes a domingo).

CREATE OR REPLACE FUNCTION public.current_week_range()
RETURNS TABLE (week_start date, week_end date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Madrid')::date;
  v_last_end date;
  v_anchor date;
  v_days_in int;
BEGIN
  -- Buscamos el final de la última temporada concluida antes de hoy
  SELECT MAX(ends_at) INTO v_last_end
  FROM public.seasons
  WHERE ends_at < v_today;

  IF v_last_end IS NOT NULL THEN
    -- Si encontramos una, el "día 1" del limbo es el día siguiente.
    -- Las semanas rotan en periodos de 7 días desde ese ancla.
    v_anchor := v_last_end + 1;
    v_days_in := v_today - v_anchor;
    week_start := v_anchor + (v_days_in / 7) * 7;
    week_end := week_start + 6;
  ELSE
    -- Si no hubo temporadas (fallback extremo), semana de calendario (L-D).
    week_start := date_trunc('week', v_today)::date;
    week_end := week_start + 6;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.current_week_range() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_week_range() TO anon, authenticated;

-- ============================================================================
-- [2] get_season_leaderboard() - Adaptación a plpgsql con fallback
-- ============================================================================
-- El comportamiento original asume que si p_season_id es NULL, pedimos
-- current_season(). Si no hay temporada actual, la CTE 's' devuelve 0 filas.
-- Ahora detectamos ese caso vacío y cargamos current_week_range().
-- Importante: se preserva la exclusión por is_flagged migrada en agosto.

DROP FUNCTION IF EXISTS public.get_season_leaderboard(uuid, int);

CREATE OR REPLACE FUNCTION public.get_season_leaderboard(
  p_season_id uuid DEFAULT NULL,
  p_limit int DEFAULT 1000
)
RETURNS TABLE (
  rank int, user_id uuid, display_name text,
  current_streak int, max_streak int, last_played_date date,
  total_wins int, total_points int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_season_id uuid;
  v_starts_at date;
  v_ends_at date;
BEGIN
  -- 1) Intentar usar la temporada solicitada, o la actual por defecto
  v_season_id := COALESCE(p_season_id, (SELECT id FROM public.current_season()));

  IF v_season_id IS NOT NULL THEN
    -- Hay temporada definida, extraemos sus fechas
    SELECT starts_at, ends_at INTO v_starts_at, v_ends_at
    FROM public.seasons
    WHERE id = v_season_id;
  ELSE
    -- No se pide una concreta y no hay ninguna activa. Caemos a rango semanal.
    SELECT c.week_start, c.week_end INTO v_starts_at, v_ends_at
    FROM public.current_week_range() c;
  END IF;

  -- 2) Ejecutar la puntuación y el ranking (idéntica a la original,
  --    solo cambian las fechas de filtrado y el flag)
  RETURN QUERY
  WITH scored AS (
    SELECT
      ug.user_id,
      CASE jsonb_array_length(ug.guesses::jsonb)
        WHEN 1 THEN 10 WHEN 2 THEN 6 WHEN 3 THEN 4
        WHEN 4 THEN 3  WHEN 5 THEN 2 WHEN 6 THEN 1 ELSE 0
      END AS base,
      EXISTS (
        SELECT 1 FROM public.daily_cars dc
        WHERE dc.date = ug.date AND dc.car_id = ug.car_id
      ) AS is_daily,
      ug.date AS won_date
    FROM public.user_guesses ug
    WHERE ug.status = 'won'
      AND ug.date >= v_starts_at
      AND ug.date <= v_ends_at
  ),
  agg AS (
    SELECT s2.user_id,
      SUM(CASE WHEN s2.is_daily THEN s2.base ELSE CEIL(s2.base/2.0) END)::int AS points,
      COUNT(*)::int AS wins,
      MAX(s2.won_date) AS last_win_date
    FROM scored s2
    GROUP BY s2.user_id
    HAVING SUM(CASE WHEN s2.is_daily THEN s2.base ELSE CEIL(s2.base/2.0) END) > 0
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY a.points DESC, a.last_win_date ASC, a.user_id)::int AS rank,
    a.user_id, p.display_name,
    COALESCE(st.current_streak,0)::int, COALESCE(st.max_streak,0)::int,
    st.last_played_date, a.wins, a.points
  FROM agg a
  JOIN public.profiles p ON p.id = a.user_id
  LEFT JOIN public.stats st ON st.user_id = a.user_id
  WHERE p.display_name IS NOT NULL AND p.display_name <> '' AND p.is_flagged IS NOT TRUE
  ORDER BY rank
  LIMIT GREATEST(1, COALESCE(p_limit, 1000));
END;
$$;

REVOKE ALL ON FUNCTION public.get_season_leaderboard(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_season_leaderboard(uuid, int) TO anon, authenticated;

-- ============================================================================
-- [3] get_current_week_range() - RPC para el frontend
-- ============================================================================
-- Envuelve current_week_range() para exponerlo como un endpoint simple.
-- Permite al banner del frontend consultar las fechas de la semana de transición.

CREATE OR REPLACE FUNCTION public.get_current_week_range()
RETURNS TABLE (week_start date, week_end date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT week_start, week_end FROM public.current_week_range();
$$;

REVOKE ALL ON FUNCTION public.get_current_week_range() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_week_range() TO anon, authenticated;
