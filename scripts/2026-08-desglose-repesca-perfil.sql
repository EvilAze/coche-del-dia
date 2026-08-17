-- scripts/2026-08-desglose-repesca-perfil.sql
--
-- El carnet del perfil público enseña «Aciertos» con `stats.total_wins`, y ese
-- contador suma TODO: los del coche del día y los de números atrasados. Con la
-- repesca a una por día, un lector veterano con mucho archivo pendiente
-- acumula victorias que un recién llegado no puede igualar por mucho que
-- acierte cada mañana — y el carnet las presentaba como si fueran lo mismo.
--
-- No se resta nada a nadie: `total_wins` sigue siendo el total. Lo que se añade
-- es el desglose, para que el número deje de significar dos cosas a la vez.
--
-- Por qué en SQL y no en el cliente: distinguir un acierto del día de uno de
-- repesca exige cruzar user_guesses con daily_cars, y daily_cars está revocada
-- para anon/authenticated a propósito (leerla desde el navegador daría el
-- calendario de coches). Por eso vive aquí, dentro del SECURITY DEFINER que ya
-- servía el perfil público.
--
-- El cruce es EL MISMO que usa get_monthly_leaderboard para puntuar la repesca
-- a mitad: «¿existe una fila de daily_cars con esta fecha y este coche?». Si no
-- existe, esa partida no era la del día. Mantenerlos idénticos es lo que evita
-- que la clasificación y el carnet cuenten distinto.
--
-- Idempotente: CREATE OR REPLACE sobre la MISMA firma (uuid → jsonb), así que
-- no hace falta DROP y se puede re-ejecutar. Se añade una clave al jsonb de
-- salida; el frontend antiguo que no la lea sigue funcionando igual.

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
  v_repesca int;
BEGIN
  -- Nickname desde profiles. La tabla `profiles` usa `id` como FK a
  -- auth.users.id (no `user_id` como `stats` o `user_guesses`).
  -- Si no existe perfil, devolvemos null y el frontend muestra "Sin nickname".
  SELECT to_jsonb(t)
    INTO v_profile
    FROM (
      SELECT display_name
      FROM public.profiles
      WHERE id = p_user_id
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

  -- Aciertos que NO fueron el coche del día = repesca. Se cuentan FILAS, no
  -- coches distintos, porque el número al que acompañan (`total_wins`) también
  -- cuenta filas: un desglose en otra unidad que su total no se puede leer.
  SELECT count(*)::int
    INTO v_repesca
    FROM public.user_guesses ug
    WHERE ug.user_id = p_user_id
      AND ug.status = 'won'
      AND NOT EXISTS (
        SELECT 1
        FROM public.daily_cars dc
        WHERE dc.date = ug.date AND dc.car_id = ug.car_id
      );

  RETURN jsonb_build_object(
    'profile', COALESCE(v_profile, '{}'::jsonb),
    'stats',   COALESCE(v_stats,   '{}'::jsonb),
    'wonCarIds', v_wins,
    'repescaWins', COALESCE(v_repesca, 0)
  );
END;
$$;

-- Permitir invocación desde anon y authenticated. La función es
-- read-only y solo expone datos que ya son públicos.
REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO anon, authenticated;

-- ── Verificación ──────────────────────────────────────────────────────────
-- Sobre un usuario cualquiera: 'repescaWins' debe existir y no pasarse del
-- total de aciertos. Devuelve solo recuentos, nunca qué coche es cuál.
--
--   SELECT (public.get_public_profile(user_id) -> 'repescaWins')::int AS repesca,
--          (public.get_public_profile(user_id) -> 'stats' -> 'total_wins')::int AS total
--     FROM public.stats
--    WHERE total_wins > 0
--    ORDER BY total_wins DESC
--    LIMIT 5;
