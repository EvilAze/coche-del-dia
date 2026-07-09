-- scripts/supabase-rank-movement.sql
--
-- «El parte de la clasificación»: movimiento de puesto VS AYER en el final de
-- partida. Necesita un histórico del puesto mensual de cada jugador, porque el
-- ranking se deriva al vuelo de user_guesses (no hay contador persistido) y por
-- tanto "mi puesto de ayer" no existe en ningún sitio hasta que lo guardamos.
--
-- PIEZAS:
--   1) rank_snapshots        — tabla: puesto mensual de cada jugador por día.
--   2) snapshot_daily_ranks()— la llena el cron diario (service_role).
--   3) get_my_monthly_rank   — se EXTIENDE para devolver prev_rank + delta.
--
-- MODELO DE "VS AYER":
--   snapshot_daily_ranks() se dispara desde el cron diario warm-daily (PASO 5,
--   "5 23 * * *" UTC ≈ 00:05/01:05 Madrid; piggyback para no superar el límite
--   de 2 cron jobs de Hobby). En ese instante el leaderboard mensual es, a
--   efectos prácticos, el CIERRE del día anterior (nadie ha
--   jugado aún el coche nuevo). Lo sellamos con la fecha de Madrid del NUEVO
--   día → snapshot(day = hoy) = "la clasificación con la que empieza hoy".
--   Durante el día, al ganar, el puesto EN VIVO mejora; el parte compara el
--   puesto en vivo con snapshot(day=hoy): delta = prev_rank - rank_actual
--   (positivo = has SUBIDO, porque un nº de puesto menor es mejor).
--
-- ZONA HORARIA: todo en Europe/Madrid, igual que el resto del ranking.
--
-- Idempotente (CREATE OR REPLACE / IF NOT EXISTS). Ejecutar una vez en el SQL
-- editor de Supabase. Requiere que scripts/supabase-monthly-ranking.sql ya esté
-- aplicado (usa get_monthly_leaderboard).

-- ============================================================================
-- 1) TABLA rank_snapshots
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.rank_snapshots (
  day        date NOT NULL,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rank       int  NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, user_id)
);

CREATE INDEX IF NOT EXISTS rank_snapshots_user_idx
  ON public.rank_snapshots (user_id, day DESC);

-- No exponemos toda la tabla: el RPC (SECURITY DEFINER) la lee igual, y cada
-- jugador solo puede ver sus propias filas por si en el futuro se consulta
-- directa. Las escrituras van por la función definer / service_role.
ALTER TABLE public.rank_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rank_snapshots_read_own ON public.rank_snapshots;
CREATE POLICY rank_snapshots_read_own ON public.rank_snapshots
  FOR SELECT USING (auth.uid() = user_id);

REVOKE ALL ON public.rank_snapshots FROM anon, authenticated;
GRANT SELECT ON public.rank_snapshots TO authenticated;


-- ============================================================================
-- 2) snapshot_daily_ranks() — la llama el cron diario
-- ============================================================================
-- Sella la clasificación mensual EN CURSO con la fecha de Madrid de HOY. Borra
-- e inserta el día (idempotente): si el cron se repite o se dispara a mano, no
-- duplica. Devuelve el nº de filas escritas.

CREATE OR REPLACE FUNCTION public.snapshot_daily_ranks()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'Europe/Madrid')::date;
  v_n   int;
BEGIN
  DELETE FROM public.rank_snapshots WHERE day = v_day;

  INSERT INTO public.rank_snapshots (day, user_id, rank)
  SELECT v_day, lb.user_id, lb.rank
  FROM public.get_monthly_leaderboard(NULL, 1000000) lb;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.snapshot_daily_ranks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.snapshot_daily_ranks() TO service_role;


-- ============================================================================
-- 3) get_my_monthly_rank(p_user_id, p_month) — EXTENDIDA con prev_rank + delta
-- ============================================================================
-- Añade a {rank, total} el puesto de referencia de HOY (snapshot sellado esta
-- madrugada = cierre de ayer) y el delta ya calculado. delta > 0 = has subido.
-- prev_rank/delta = NULL si aún no hay snapshot de hoy (primer día, o el cron
-- no ha corrido todavía) → el frontend cae a copy neutro ("estrenas puesto").
--
-- Cambia la firma de retorno (nuevas columnas) → DROP previo obligatorio.

DROP FUNCTION IF EXISTS public.get_my_monthly_rank(uuid, date);

CREATE OR REPLACE FUNCTION public.get_my_monthly_rank(
  p_user_id uuid,
  p_month date DEFAULT NULL
)
RETURNS TABLE (
  rank int,
  total int,
  prev_rank int,
  delta int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lb AS (
    SELECT mlb.rank, mlb.user_id
    FROM public.get_monthly_leaderboard(p_month, 1000000) mlb
  ),
  me AS (
    SELECT
      (SELECT lb.rank FROM lb WHERE lb.user_id = p_user_id)::int AS rank,
      (SELECT count(*) FROM lb)::int                            AS total
  ),
  prev AS (
    SELECT rs.rank AS prev_rank
    FROM public.rank_snapshots rs
    WHERE rs.user_id = p_user_id
      AND rs.day = (now() AT TIME ZONE 'Europe/Madrid')::date
    LIMIT 1
  )
  SELECT
    me.rank,
    me.total,
    prev.prev_rank,
    CASE
      WHEN me.rank IS NOT NULL AND prev.prev_rank IS NOT NULL
      THEN prev.prev_rank - me.rank
      ELSE NULL
    END AS delta
  FROM me LEFT JOIN prev ON true;
$$;

-- rank/total/delta son datos ya públicos (posición en un ranking público).
REVOKE ALL ON FUNCTION public.get_my_monthly_rank(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_monthly_rank(uuid, date) TO anon, authenticated;


-- ============================================================================
-- 4) SEMBRAR BASELINE A MANO (para probar YA en el Preview)
-- ============================================================================
-- El parte solo muestra "movimiento" cuando existe el snapshot de hoy. El cron
-- lo crea de madrugada; para probarlo sin esperar, ejecuta UNA vez:
--
--   SELECT public.snapshot_daily_ranks();
--
-- Eso sella la clasificación actual como baseline de hoy. Después, al ganar una
-- partida, tu puesto en vivo cambia y el parte mostrará el delta.
