-- scripts/supabase-achievements-persistence.sql
--
-- Persistencia de logros "freeze on unlock":
-- Una vez un usuario alcanza un tier, ese tier es SUYO para siempre, aunque
-- el catálogo crezca y los porcentajes muevan los umbrales.
--
-- Modelo:
--   stats.achievements_unlocked: jsonb. Mapa { achievementId -> tier|true }.
--     - Colecciones (brand/country): value = "bronze"|"silver"|"gold".
--     - Hitos / rachas:              value = true (booleano).
--
-- Operaciones:
--   - Leer:    se incluye en getMyStats() y en get_public_profile (RPC).
--   - Escribir: vía RPC persist_achievement_unlocks(p_unlocks) — el cliente
--     manda solo el DELTA (nuevos desbloqueos), el servidor hace merge naive
--     (jsonb ||) con lo existente. La frontend solo manda valores "más altos
--     o iguales" → no hay regresión por construcción.
--
-- Script idempotente: se puede ejecutar varias veces sin problema.

-- ============================================================================
-- 1) Columna nueva en stats
-- ============================================================================

ALTER TABLE public.stats
  ADD COLUMN IF NOT EXISTS achievements_unlocked jsonb
    NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================================
-- 2) RPC: persistir desbloqueos del usuario actual
-- ============================================================================

CREATE OR REPLACE FUNCTION public.persist_achievement_unlocks(p_unlocks jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_current jsonb;
  v_merged  jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validación básica de payload.
  IF p_unlocks IS NULL OR jsonb_typeof(p_unlocks) <> 'object' THEN
    RAISE EXCEPTION 'Invalid unlocks payload';
  END IF;

  -- Cap defensivo: no aceptamos payloads gigantes (un atacante podría
  -- intentar inflar el JSONB del usuario).
  IF length(p_unlocks::text) > 16384 THEN
    RAISE EXCEPTION 'Payload too large';
  END IF;

  -- Leer estado actual del usuario. Si no existe fila en stats, partimos
  -- de '{}' y crearemos la fila vía upsert al final.
  SELECT COALESCE(achievements_unlocked, '{}'::jsonb)
    INTO v_current
    FROM public.stats
    WHERE user_id = v_user_id;

  v_merged := COALESCE(v_current, '{}'::jsonb) || p_unlocks;

  -- Upsert: si la fila no existía, la creamos vacía con solo el campo
  -- de logros poblado. El resto de columnas (total_points, etc.) ya
  -- tienen defaults en la tabla.
  INSERT INTO public.stats (user_id, achievements_unlocked)
    VALUES (v_user_id, v_merged)
    ON CONFLICT (user_id) DO UPDATE
      SET achievements_unlocked = v_merged;

  RETURN v_merged;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_achievement_unlocks(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_achievement_unlocks(jsonb) TO authenticated;

-- ============================================================================
-- 3) Actualizar get_public_profile para incluir achievements_unlocked
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_public_profile(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile           jsonb;
  v_stats             jsonb;
  v_wins              jsonb;
  v_unlocks           jsonb;
BEGIN
  -- Nickname desde profiles (la tabla usa `id` como FK a auth.users.id).
  SELECT to_jsonb(t)
    INTO v_profile
    FROM (
      SELECT display_name
      FROM public.profiles
      WHERE id = p_user_id
    ) AS t;

  -- Stats públicas: mismos campos que ya expone el leaderboard.
  SELECT to_jsonb(t)
    INTO v_stats
    FROM (
      SELECT current_streak, max_streak, total_wins, total_points
      FROM public.stats
      WHERE user_id = p_user_id
    ) AS t;

  -- Lista única de coches ganados.
  SELECT COALESCE(jsonb_agg(DISTINCT car_id), '[]'::jsonb)
    INTO v_wins
    FROM public.user_guesses
    WHERE user_id = p_user_id
      AND status = 'won';

  -- Snapshot persistido de logros desbloqueados (para que terceros
  -- vean el GOLD frozen del usuario aunque el catálogo haya crecido).
  SELECT COALESCE(achievements_unlocked, '{}'::jsonb)
    INTO v_unlocks
    FROM public.stats
    WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'profile',              COALESCE(v_profile, '{}'::jsonb),
    'stats',                COALESCE(v_stats,   '{}'::jsonb),
    'wonCarIds',            v_wins,
    'achievementsUnlocked', COALESCE(v_unlocks, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO anon, authenticated;
