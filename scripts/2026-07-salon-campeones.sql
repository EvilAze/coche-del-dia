-- scripts/2026-07-salon-campeones.sql
-- SALÓN DE CAMPEONES: lectura pública del palmarés histórico de temporadas.
-- Los datos YA existen —close_finished_seasons() sella el podio (top-3) de cada
-- temporada en season_podium (ver scripts/2026-07-temporadas.sql)—; lo único que
-- faltaba era una vista que los liste temporada a temporada. Este RPC lo hace.
--
-- ADITIVO: no toca el motor de puntos ni ninguna tabla; solo añade una función
-- de lectura. Aplicar en el SQL editor de Supabase. Idempotente (CREATE OR
-- REPLACE). Espejo de estilo de get_season_leaderboard (SECURITY DEFINER +
-- join a profiles, que respeta la privacidad del display_name).

-- ============================================================================
-- get_champions(p_limit) — temporadas CERRADAS con podio, top-3 + nombre
-- ============================================================================
-- Solo temporadas selladas (closed_at not null) que TENGAN podio: las de menos
-- de 5 jugadores no otorgan medallas (umbral anti "campeón de temporada vacía"
-- en compute_season_podium), así que no aparecen. Orden: temporada más reciente
-- primero, y dentro, oro→plata→bronce. p_limit acota cuántas temporadas devuelve
-- (el histórico no crece sin control en el cliente).
DROP FUNCTION IF EXISTS public.get_champions(int);
CREATE OR REPLACE FUNCTION public.get_champions(p_limit int DEFAULT 24)
RETURNS TABLE (
  season_id  uuid, number int, label_es text, label_en text,
  starts_at  date, ends_at date,
  rank       int, user_id uuid, display_name text, points int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH closed AS (
    SELECT s.*
    FROM public.seasons s
    WHERE s.closed_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.season_podium sp WHERE sp.season_id = s.id)
    ORDER BY s.number DESC
    LIMIT GREATEST(1, COALESCE(p_limit, 24))
  )
  SELECT
    c.id, c.number, c.label_es, c.label_en, c.starts_at, c.ends_at,
    sp.rank, sp.user_id, p.display_name, sp.points
  FROM closed c
  JOIN public.season_podium sp ON sp.season_id = c.id
  JOIN public.profiles p ON p.id = sp.user_id
  WHERE p.display_name IS NOT NULL AND p.display_name <> ''
  ORDER BY c.number DESC, sp.rank ASC;
$$;
REVOKE ALL ON FUNCTION public.get_champions(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_champions(int) TO anon, authenticated;
