-- daily_stats: contadores agregados para las estadísticas post-partida.
-- Una fila por día, actualizada atómicamente vía increment_daily_stats.
-- Tanto logueados como anónimos contribuyen.
--
-- Ejecutar en Supabase SQL Editor (una sola vez).

CREATE TABLE IF NOT EXISTS public.daily_stats (
  date         DATE    PRIMARY KEY,
  total_games  INTEGER NOT NULL DEFAULT 0,
  wins         INTEGER NOT NULL DEFAULT 0,
  losses       INTEGER NOT NULL DEFAULT 0,
  attempt_1    INTEGER NOT NULL DEFAULT 0,
  attempt_2    INTEGER NOT NULL DEFAULT 0,
  attempt_3    INTEGER NOT NULL DEFAULT 0,
  attempt_4    INTEGER NOT NULL DEFAULT 0,
  attempt_5    INTEGER NOT NULL DEFAULT 0
);

-- RLS activado con lectura pública (las stats son públicas por diseño).
ALTER TABLE public.daily_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON public.daily_stats
  FOR SELECT USING (true);

-- Lectura para anon y authenticated (el endpoint /api/daily-stats usa
-- supabaseAdmin, pero por si se consume desde cliente directo).
GRANT SELECT ON public.daily_stats TO anon, authenticated;

-- RPC atómica: upsert con ON CONFLICT. Llamada desde api/validate-guess.js
-- con supabaseAdmin (service_role). SECURITY DEFINER para que ejecute con
-- privilegios de owner independientemente del caller.
CREATE OR REPLACE FUNCTION public.increment_daily_stats(
  p_date    DATE,
  p_won     BOOLEAN,
  p_attempt INTEGER
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.daily_stats
    (date, total_games, wins, losses, attempt_1, attempt_2, attempt_3, attempt_4, attempt_5)
  VALUES (
    p_date,
    1,
    (p_won)::int,
    (NOT p_won)::int,
    (p_won AND p_attempt = 1)::int,
    (p_won AND p_attempt = 2)::int,
    (p_won AND p_attempt = 3)::int,
    (p_won AND p_attempt = 4)::int,
    (p_won AND p_attempt = 5)::int
  )
  ON CONFLICT (date) DO UPDATE SET
    total_games = daily_stats.total_games + 1,
    wins        = daily_stats.wins    + (p_won)::int,
    losses      = daily_stats.losses  + (NOT p_won)::int,
    attempt_1   = daily_stats.attempt_1 + (p_won AND p_attempt = 1)::int,
    attempt_2   = daily_stats.attempt_2 + (p_won AND p_attempt = 2)::int,
    attempt_3   = daily_stats.attempt_3 + (p_won AND p_attempt = 3)::int,
    attempt_4   = daily_stats.attempt_4 + (p_won AND p_attempt = 4)::int,
    attempt_5   = daily_stats.attempt_5 + (p_won AND p_attempt = 5)::int;
END;
$$;
