-- scripts/2026-07-temporadas.sql
-- TEMPORADAS TEMÁTICAS: reemplazan el ranking mensual por ciclos cortos (1-2 sem)
-- con temática. Es el mensual GENERALIZADO: misma derivación de puntos base, solo
-- que los límites salen de la fila `seasons` en vez de date_trunc('month'). Espejo
-- de scripts/supabase-monthly-ranking.sql — NO diverjas del cálculo de puntos sin
-- sincronizar ambos.
--
-- FASE 1 es ADITIVA: crea tablas y funciones nuevas SIN tocar el mensual ni
-- snapshot_daily_ranks (el "flip" va en la Fase 2). Aplicar en el SQL editor de
-- Supabase. Idempotente (CREATE OR REPLACE / IF NOT EXISTS).

-- ============================================================================
-- 0) Extensión para el constraint de no-solape (rangos GiST)
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================================
-- 1) TABLA seasons — fuente de verdad de la temporada activa
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.seasons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number     int  NOT NULL,               -- "Temporada 7" (display)
  label_es   text NOT NULL,               -- "Grupo B", "Coches de carreras"
  label_en   text NOT NULL,               -- "Group B", "Racing cars"
  starts_at  date NOT NULL,               -- inclusivo, calendario Madrid
  ends_at    date NOT NULL,               -- inclusivo, calendario Madrid
  closed_at  timestamptz,                 -- lo sella close_finished_seasons()
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seasons_range_ok CHECK (ends_at >= starts_at)
);

-- No dos temporadas solapadas → current_season() siempre única. Si tu proyecto
-- no permite el constraint gist, quítalo y valida el no-solape en el editor
-- admin (Fase 3).
ALTER TABLE public.seasons DROP CONSTRAINT IF EXISTS seasons_no_overlap;
ALTER TABLE public.seasons
  ADD CONSTRAINT seasons_no_overlap
  EXCLUDE USING gist (daterange(starts_at, ends_at, '[]') WITH &&);

-- Público: el tema y las fechas son el gancho de marketing (banner + countdown).
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS seasons_read ON public.seasons;
CREATE POLICY seasons_read ON public.seasons FOR SELECT USING (true);
REVOKE ALL ON public.seasons FROM anon, authenticated;
GRANT SELECT ON public.seasons TO anon, authenticated;

-- ============================================================================
-- 2) current_season() — la temporada que contiene HOY (Madrid)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_season()
RETURNS public.seasons
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT * FROM public.seasons
  WHERE (now() AT TIME ZONE 'Europe/Madrid')::date BETWEEN starts_at AND ends_at
  ORDER BY starts_at DESC
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.current_season() TO anon, authenticated;

-- ============================================================================
-- 3) get_season_leaderboard(p_season_id, p_limit) — el mensual generalizado
-- ============================================================================
-- Espejo EXACTO de get_monthly_leaderboard salvo los límites: [starts_at, ends_at]
-- de la temporada (ambos inclusivos) en vez del mes. p_season_id NULL →
-- current_season(). Mismo set de columnas para reutilizar el render de filas.
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH s AS (
    SELECT * FROM public.seasons
    WHERE id = COALESCE(p_season_id, (SELECT id FROM public.current_season()))
  ),
  scored AS (
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
    FROM public.user_guesses ug, s
    WHERE ug.status = 'won'
      AND ug.date >= s.starts_at
      AND ug.date <= s.ends_at            -- ends_at INCLUSIVO
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
  WHERE p.display_name IS NOT NULL AND p.display_name <> ''
  ORDER BY rank
  LIMIT GREATEST(1, COALESCE(p_limit, 1000));
$$;
REVOKE ALL ON FUNCTION public.get_season_leaderboard(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_season_leaderboard(uuid, int) TO anon, authenticated;

-- ============================================================================
-- 4) get_my_season_rank(p_user_id, p_season_id) — mi puesto + movimiento vs ayer
-- ============================================================================
-- Espejo de get_my_monthly_rank: rank + total + prev_rank + delta. prev_rank sale
-- de rank_snapshots (lo sella snapshot_daily_ranks; en Fase 2 ese snapshot pasa a
-- ser de temporada). delta > 0 = ha subido.
DROP FUNCTION IF EXISTS public.get_my_season_rank(uuid, uuid);
CREATE OR REPLACE FUNCTION public.get_my_season_rank(
  p_user_id uuid,
  p_season_id uuid DEFAULT NULL
)
RETURNS TABLE (rank int, total int, prev_rank int, delta int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH lb AS (
    SELECT slb.rank, slb.user_id
    FROM public.get_season_leaderboard(p_season_id, 1000000) slb
  ),
  me AS (
    SELECT
      (SELECT lb.rank FROM lb WHERE lb.user_id = p_user_id)::int AS rank,
      (SELECT count(*) FROM lb)::int AS total
  ),
  prev AS (
    SELECT rs.rank AS prev_rank
    FROM public.rank_snapshots rs
    WHERE rs.user_id = p_user_id
      AND rs.day = (now() AT TIME ZONE 'Europe/Madrid')::date
    LIMIT 1
  )
  SELECT me.rank, me.total, prev.prev_rank,
    CASE WHEN me.rank IS NOT NULL AND prev.prev_rank IS NOT NULL
         THEN prev.prev_rank - me.rank ELSE NULL END AS delta
  FROM me LEFT JOIN prev ON true;
$$;
REVOKE ALL ON FUNCTION public.get_my_season_rank(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_season_rank(uuid, uuid) TO anon, authenticated;

-- ============================================================================
-- 5) season_podium (clon de monthly_podium) + compute + close
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.season_podium (
  season_id  uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  rank       int  NOT NULL CHECK (rank BETWEEN 1 AND 3),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  points     int  NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, rank)
);
CREATE INDEX IF NOT EXISTS season_podium_user_idx ON public.season_podium (user_id);
ALTER TABLE public.season_podium ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS season_podium_read ON public.season_podium;
CREATE POLICY season_podium_read ON public.season_podium FOR SELECT USING (true);
REVOKE ALL ON public.season_podium FROM anon, authenticated;
GRANT SELECT ON public.season_podium TO anon, authenticated;

-- Calcula y persiste el podio de una temporada. Idempotente (borra+reinserta).
-- Umbral anti "campeón de temporada vacía": < p_min_players rankeados → 0 medallas.
CREATE OR REPLACE FUNCTION public.compute_season_podium(
  p_season_id uuid, p_min_players int DEFAULT 5
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_players int; v_written int := 0;
BEGIN
  SELECT count(*) INTO v_players FROM public.get_season_leaderboard(p_season_id, 1000000);
  DELETE FROM public.season_podium WHERE season_id = p_season_id;
  IF v_players < p_min_players THEN RETURN 0; END IF;
  INSERT INTO public.season_podium (season_id, rank, user_id, points)
  SELECT p_season_id, lb.rank, lb.user_id, lb.total_points
  FROM public.get_season_leaderboard(p_season_id, 3) lb WHERE lb.rank <= 3;
  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written;
END; $$;

-- Cierra TODAS las temporadas ya terminadas y sin sellar. `closed_at` evita
-- recomputar en bucle una temporada sub-umbral (0 medallas): se marca cerrada
-- aunque no otorgue podio. Robusto a que el cron falle un día (recoge pendientes).
-- La llama warm-daily (PASO 6). Cadencia variable resuelta con un chequeo diario,
-- SIN cron nuevo (límite de 2 en Hobby).
CREATE OR REPLACE FUNCTION public.close_finished_seasons()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Madrid')::date;
  r record; v_count int := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.seasons WHERE ends_at < v_today AND closed_at IS NULL
  LOOP
    PERFORM public.compute_season_podium(r.id, 5);
    UPDATE public.seasons SET closed_at = now() WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $$;

REVOKE ALL ON FUNCTION public.compute_season_podium(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_finished_seasons()        FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_finished_seasons() TO service_role;
