-- scripts/supabase-public-profile-rpc.sql
--
-- RPC pública para devolver el "perfil público" de cualquier usuario:
-- nickname, stats (los mismos campos que ya expone el leaderboard) y la
-- lista de car_ids que ha ganado (necesaria para calcular sus logros).
--
-- Se usa SECURITY DEFINER para poder leer user_guesses sin que el RLS
-- restrinja a la sesión del llamador. Limitamos lo que devolvemos a lo
-- estrictamente necesario para el perfil público (NO devolvemos los
-- intentos en sí, solo qué coches ha ganado).
--
-- Ejecutar este script una vez en el SQL editor de Supabase. Se puede
-- volver a ejecutar sin problemas (CREATE OR REPLACE FUNCTION es
-- idempotente).
--
-- Permisos: ejecutable por roles anon y authenticated. Lo que devuelve
-- son datos que YA son públicos (stats vía leaderboard) o derivables
-- por enumeración (car_ids son ids de catálogo).

CREATE OR REPLACE FUNCTION public.get_public_profile(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile jsonb;
  v_stats   jsonb;
  v_wins    jsonb;
BEGIN
  -- Nickname desde profiles. Si no existe perfil, devolvemos null
  -- para que el frontend renderice "Sin perfil" o similar.
  SELECT to_jsonb(t)
    INTO v_profile
    FROM (
      SELECT display_name
      FROM public.profiles
      WHERE user_id = p_user_id
    ) AS t;

  -- Stats relevantes para el perfil público. MISMOS campos que el
  -- leaderboard expone hoy, ni uno más.
  SELECT to_jsonb(t)
    INTO v_stats
    FROM (
      SELECT current_streak, max_streak, total_wins, total_points
      FROM public.stats
      WHERE user_id = p_user_id
    ) AS t;

  -- Lista única de coches ganados (status='won'). Sirve para que el
  -- cliente calcule los logros del usuario reusando computeAchievements.
  SELECT COALESCE(jsonb_agg(DISTINCT car_id), '[]'::jsonb)
    INTO v_wins
    FROM public.user_guesses
    WHERE user_id = p_user_id
      AND status = 'won';

  RETURN jsonb_build_object(
    'profile', COALESCE(v_profile, '{}'::jsonb),
    'stats',   COALESCE(v_stats,   '{}'::jsonb),
    'wonCarIds', v_wins
  );
END;
$$;

-- Permitir invocación desde anon y authenticated. La función es
-- read-only y solo expone datos que ya son públicos.
REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO anon, authenticated;
