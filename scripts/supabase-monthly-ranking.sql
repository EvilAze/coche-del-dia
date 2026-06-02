-- scripts/supabase-monthly-ranking.sql
--
-- Ranking MENSUAL + medallas de PODIO. Dos features que comparten un mismo
-- núcleo: derivar los puntos base ganados por cada jugador en un mes a partir
-- de `user_guesses` (NO se persiste un contador mensual; igual que los logros,
-- todo se recalcula al vuelo desde la fuente, ver src/lib/achievements.js).
--
-- DERIVACIÓN DE PUNTOS (espejo del backend, NO la toques sin sincronizar):
--   - Puntos base diarios por nº de intento (api/validate-guess.js):
--       intento 1→10, 2→6, 3→4, 4→3, 5→2, 6→1
--     El nº de intento ganador = nº de elementos del array `guesses`.
--   - Una fila ganada (status='won') es DAILY si (date, car_id) existe en
--     `daily_cars`; en caso contrario es REPESCA, que vale la MITAD de los
--     puntos redondeando hacia arriba (api/repesca/validate.js: ceil(base/2)).
--   - El bonus de racha NO entra en el cómputo mensual a propósito: el
--     mensual mide "puntos base del mes", una métrica limpia y alcanzable
--     para los recién llegados (el global de `stats.total_points` sí lo
--     incluye, pero ese es otro ranking).
--
-- ZONA HORARIA: `user_guesses.date` ya guarda la fecha de Madrid (el backend
-- usa todayInMadrid()). El "mes actual" se calcula también en Madrid para que
-- el corte de mes coincida con el corte de día del juego.
--
-- Ejecutar este script una vez en el SQL editor de Supabase. Es idempotente
-- (CREATE OR REPLACE / IF NOT EXISTS): se puede re-ejecutar sin efectos
-- colaterales. Al final hay un paso OPCIONAL de backfill retroactivo.

-- ============================================================================
-- 1) RANKING MENSUAL: get_monthly_leaderboard(p_month, p_limit)
-- ============================================================================
-- Devuelve, para el mes que contiene p_month (o el mes actual de Madrid si es
-- NULL), la tabla ordenada de jugadores con puntos > 0 y nickname puesto.
-- Mismo set de columnas que el leaderboard global (useStats.getLeaderboard)
-- para que el frontend reutilice el mismo render de filas.
--
-- SECURITY DEFINER: necesita leer user_guesses (cuyo RLS restringe a la propia
-- sesión). Solo expone agregados + datos ya públicos (nickname, puntos), nunca
-- los intentos individuales. Mismo criterio que get_public_profile.

CREATE OR REPLACE FUNCTION public.get_monthly_leaderboard(
  p_month date DEFAULT NULL,
  p_limit int DEFAULT 1000
)
RETURNS TABLE (
  rank int,
  user_id uuid,
  display_name text,
  current_streak int,
  max_streak int,
  total_wins int,
  total_points int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rng AS (
    SELECT
      date_trunc('month',
        COALESCE(p_month, (now() AT TIME ZONE 'Europe/Madrid')::date)
      )::date AS start
  ),
  bounds AS (
    SELECT start, (start + interval '1 month')::date AS stop FROM rng
  ),
  scored AS (
    SELECT
      ug.user_id,
      -- Puntos base por nº de intento (= longitud del array de guesses).
      CASE jsonb_array_length(ug.guesses::jsonb)
        WHEN 1 THEN 10 WHEN 2 THEN 6 WHEN 3 THEN 4
        WHEN 4 THEN 3  WHEN 5 THEN 2 WHEN 6 THEN 1 ELSE 0
      END AS base,
      -- ¿Era el coche del día de esa fecha? Si no, es una repesca.
      EXISTS (
        SELECT 1 FROM public.daily_cars dc
        WHERE dc.date = ug.date AND dc.car_id = ug.car_id
      ) AS is_daily,
      ug.date AS won_date
    FROM public.user_guesses ug, bounds
    WHERE ug.status = 'won'
      AND ug.date >= bounds.start
      AND ug.date <  bounds.stop
  ),
  agg AS (
    SELECT
      s.user_id,
      SUM(CASE WHEN s.is_daily THEN s.base ELSE CEIL(s.base / 2.0) END)::int AS points,
      COUNT(*)::int AS wins,
      MAX(s.won_date) AS last_win_date
    FROM scored s
    GROUP BY s.user_id
    HAVING SUM(CASE WHEN s.is_daily THEN s.base ELSE CEIL(s.base / 2.0) END) > 0
  )
  SELECT
    ROW_NUMBER() OVER (
      ORDER BY a.points DESC, a.last_win_date ASC, a.user_id
    )::int AS rank,
    a.user_id,
    p.display_name,
    COALESCE(s.current_streak, 0)::int AS current_streak,
    COALESCE(s.max_streak, 0)::int     AS max_streak,
    a.wins   AS total_wins,
    a.points AS total_points
  FROM agg a
  JOIN public.profiles p ON p.id = a.user_id
  LEFT JOIN public.stats s ON s.user_id = a.user_id
  WHERE p.display_name IS NOT NULL AND p.display_name <> ''
  ORDER BY rank
  LIMIT GREATEST(1, COALESCE(p_limit, 1000));
$$;

-- Lectura pública (datos ya públicos vía leaderboard).
REVOKE ALL ON FUNCTION public.get_monthly_leaderboard(date, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_monthly_leaderboard(date, int) TO anon, authenticated;


-- ============================================================================
-- 2) MEDALLAS DE PODIO: tabla-caché monthly_podium
-- ============================================================================
-- Snapshot del top-3 de cada mes CERRADO. No es fuente de verdad: si se
-- pierde, se recalcula desde user_guesses con compute_monthly_podium. Lo
-- materializamos porque recalcular todos los meses pasados en cada apertura
-- de perfil sería caro y crecería sin límite.
--
-- `month` = primer día del mes (date_trunc('month')). rank ∈ {1,2,3}.

CREATE TABLE IF NOT EXISTS public.monthly_podium (
  month      date NOT NULL,
  rank       int  NOT NULL CHECK (rank BETWEEN 1 AND 3),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  points     int  NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (month, rank)
);

CREATE INDEX IF NOT EXISTS monthly_podium_user_idx
  ON public.monthly_podium (user_id);

-- El podio es público (igual que el ranking). Solo SELECT para todos; las
-- escrituras van por la función SECURITY DEFINER / service_role.
ALTER TABLE public.monthly_podium ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS monthly_podium_read ON public.monthly_podium;
CREATE POLICY monthly_podium_read ON public.monthly_podium
  FOR SELECT USING (true);

REVOKE ALL ON public.monthly_podium FROM anon, authenticated;
GRANT SELECT ON public.monthly_podium TO anon, authenticated;


-- ============================================================================
-- 3) compute_monthly_podium(p_month, p_min_players)
-- ============================================================================
-- Calcula y persiste el podio de un mes. Idempotente: borra y reinserta.
-- Umbral anti "campeón de un mes vacío": si jugaron menos de p_min_players
-- (con puntos > 0 y nickname), NO se otorgan medallas ese mes (devuelve 0).
-- Devuelve el nº de filas de podio escritas.

CREATE OR REPLACE FUNCTION public.compute_monthly_podium(
  p_month date,
  p_min_players int DEFAULT 5
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start        date := date_trunc('month', p_month)::date;
  v_player_count int;
  v_written      int := 0;
BEGIN
  SELECT count(*) INTO v_player_count
  FROM public.get_monthly_leaderboard(v_start, 1000);

  -- Recalcular siempre desde cero (idempotente).
  DELETE FROM public.monthly_podium WHERE month = v_start;

  IF v_player_count < p_min_players THEN
    RETURN 0;  -- mes con poca actividad: sin medallas
  END IF;

  INSERT INTO public.monthly_podium (month, rank, user_id, points)
  SELECT v_start, lb.rank, lb.user_id, lb.total_points
  FROM public.get_monthly_leaderboard(v_start, 3) lb
  WHERE lb.rank <= 3;

  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written;
END;
$$;


-- ============================================================================
-- 4) snapshot_previous_month_podium()  — la llama el cron mensual
-- ============================================================================
-- Cierra el mes ANTERIOR (en zona Madrid). Pensada para dispararse el día 1
-- de cada mes desde api/cron/monthly-podium.js (service_role).

CREATE OR REPLACE FUNCTION public.snapshot_previous_month_podium()
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.compute_monthly_podium(
    (date_trunc('month', (now() AT TIME ZONE 'Europe/Madrid')) - interval '1 month')::date,
    5
  );
$$;


-- ============================================================================
-- 5) backfill_monthly_podiums(p_min_players) — relleno retroactivo
-- ============================================================================
-- Recorre todos los meses CERRADOS con victorias en user_guesses y calcula su
-- podio. Sirve para poblar las medallas históricas el día del despliegue.
-- Devuelve el nº de meses procesados (algunos pueden no otorgar medallas si no
-- llegan al umbral). El mes EN CURSO se excluye siempre.

CREATE OR REPLACE FUNCTION public.backfill_monthly_podiums(
  p_min_players int DEFAULT 5
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month         date;
  v_current_month date := date_trunc('month', (now() AT TIME ZONE 'Europe/Madrid'))::date;
  v_count         int := 0;
BEGIN
  FOR v_month IN
    SELECT DISTINCT date_trunc('month', ug.date)::date AS m
    FROM public.user_guesses ug
    WHERE ug.status = 'won'
    ORDER BY 1
  LOOP
    IF v_month < v_current_month THEN
      PERFORM public.compute_monthly_podium(v_month, p_min_players);
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;


-- Las funciones de escritura NO son invocables por clientes: solo el cron
-- (service_role) o el admin desde el SQL editor (rol owner).
REVOKE ALL ON FUNCTION public.compute_monthly_podium(date, int)       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.snapshot_previous_month_podium()        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_monthly_podiums(int)           FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.snapshot_previous_month_podium() TO service_role;


-- ============================================================================
-- 6) BACKFILL RETROACTIVO (OPCIONAL — ejecútalo a mano una vez)
-- ============================================================================
-- Descomenta y ejecuta esta línea UNA vez tras desplegar para poblar las
-- medallas de todos los meses cerrados que ya tengan actividad suficiente:
--
--   SELECT public.backfill_monthly_podiums(5);
--
-- Para revisar qué saldría en un mes concreto antes de nada (read-only):
--
--   SELECT * FROM public.get_monthly_leaderboard('2026-05-01', 10);
