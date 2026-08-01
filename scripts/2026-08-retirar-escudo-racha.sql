-- scripts/2026-08-retirar-escudo-racha.sql
--
-- RETIRA EL ESCUDO DE RACHA (streak freeze). Sustituye a
-- scripts/supabase-streak-freeze.sql, que queda como histórico: NO lo vuelvas
-- a ejecutar o resucitarás la mecánica.
--
-- POR QUÉ SE RETIRA (la decisión, para que dentro de un año se entienda):
--
--   · El escudo es un SEGURO, y un seguro que no sabes que tienes no te
--     tranquiliza. Existía para evitar el "ya rompí la racha, para qué vuelvo",
--     pero ese pensamiento ocurre ANTES de volver a abrir la web — y ahí el
--     jugador no sabía que tenía red. Solo actuaba a posteriori, cuando ya
--     había vuelto: justo cuando ya no hacía falta convencerle de nada.
--
--   · En silencio, erosionaba la propia racha. La fuerza de una racha viene de
--     ser un contrato inequívoco ("juega cada día o la pierdes"). Si un día
--     faltas y la racha sobrevive sin que sepas por qué, deja de ser un
--     contrato. Y aquí eso importa el doble: la racha es la palanca de
--     conversión del anónimo ("no pierdas tu racha de 5 días"), y esa frase
--     solo pesa si la racha de verdad se pierde.
--
--   · Hacerlo visible costaba la superficie más cara que hay: la regla en
--     "Cómo se juega" era la 6ª de 6 y la más larga con diferencia (tres
--     cláusulas frente a la frase única de las otras cinco), en un juego cuyo
--     norte es menos jerga y dos minutos de partida.
--
--   · Y arrastraba dos defectos propios: el ranking y tu perfil no coincidían
--     el día del hueco (las tablas no leían el inventario), y la economía
--     (+1 por cada múltiplo de 10 de racha, tope 2) se secaba justo para el
--     jugador casual, que es para quien se diseñó la red.
--
-- QUÉ HACE ESTE SCRIPT: devuelve record_daily_result a la regla simple —
-- consecutivo o reset— y deja de tocar el inventario. Idempotente.
--
-- QUÉ **NO** HACE: no borra la columna public.stats.streak_freezes ni su GRANT.
-- Se queda ahí, muerta, para no arrastrar una migración destructiva sobre una
-- tabla viva; nadie la lee ni la escribe ya. Si algún día quieres el espacio:
--   ALTER TABLE public.stats DROP COLUMN streak_freezes;
--
-- record_daily_result_v2 (el envoltorio anti-cheat) NO cambia: delega aquí.
-- Si tu v2 reconstruye el jsonb clave a clave en vez de reenviarlo, las dos
-- claves 'freezeUsed' / 'streakFreezes' pasarán a null — no las lee nadie
-- (ver api/validate-guess.js).

CREATE OR REPLACE FUNCTION public.record_daily_result(p_won boolean, p_attempt_number integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id      UUID := auth.uid();
  v_today        DATE := (now() AT TIME ZONE 'Europe/Madrid')::date;
  v_yesterday    DATE := v_today - 1;
  v_row          public.stats%ROWTYPE;
  v_base_points  INTEGER;
  v_streak_bonus INTEGER;
  v_new_streak   INTEGER;
  v_total_today  INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Tabla base por intento (solo si acertó). RÉPLICA: la misma curva vive en
  -- api/_lib/score.js y en supabase-monthly-ranking.sql. Si la tocas aquí,
  -- tócala en los tres o el ranking divergirá del número que ve el jugador.
  IF p_won THEN
    v_base_points := CASE p_attempt_number
      WHEN 1 THEN 10
      WHEN 2 THEN 6
      WHEN 3 THEN 4
      WHEN 4 THEN 3
      WHEN 5 THEN 2
      WHEN 6 THEN 1
      ELSE 0
    END;
  ELSE
    v_base_points := 0;
  END IF;

  -- Crear fila de stats si no existe, y bloquearla para la transacción
  INSERT INTO public.stats (user_id) VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row FROM public.stats WHERE user_id = v_user_id FOR UPDATE;

  -- Idempotencia: si ya jugó hoy, no contamos dos veces
  IF v_row.last_played_date = v_today THEN
    RETURN jsonb_build_object(
      'basePoints',      0,
      'streakBonus',     0,
      'totalPoints',     0,
      'currentStreak',   v_row.current_streak,
      'maxStreak',       v_row.max_streak,
      'totalScore',      v_row.total_points,
      'alreadyRecorded', true
    );
  END IF;

  -- Cálculo de racha: consecutivo o vuelta a empezar. Sin excepciones — que es
  -- justo lo que la hace legible sin explicarla.
  IF p_won THEN
    IF v_row.last_played_date = v_yesterday AND v_row.current_streak > 0 THEN
      v_new_streak := v_row.current_streak + 1;
    ELSE
      v_new_streak := 1;  -- primer acierto, o vuelve tras un hueco
    END IF;
  ELSE
    v_new_streak := 0;    -- jugar y fallar corta la racha
  END IF;

  -- Bonus de racha (solo aplica si ganó; cap a +3)
  IF p_won THEN
    v_streak_bonus := CASE
      WHEN v_new_streak >= 4 THEN 3
      WHEN v_new_streak  = 3 THEN 2
      WHEN v_new_streak  = 2 THEN 1
      ELSE 0
    END;
  ELSE
    v_streak_bonus := 0;
  END IF;

  v_total_today := v_base_points + v_streak_bonus;

  UPDATE public.stats SET
    current_streak   = v_new_streak,
    max_streak       = GREATEST(max_streak, v_new_streak),
    total_wins       = total_wins + CASE WHEN p_won THEN 1 ELSE 0 END,
    total_points     = total_points + v_total_today,
    last_played_date = v_today
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'basePoints',      v_base_points,
    'streakBonus',     v_streak_bonus,
    'totalPoints',     v_total_today,
    'currentStreak',   v_new_streak,
    'maxStreak',       GREATEST(v_row.max_streak, v_new_streak),
    'totalScore',      v_row.total_points + v_total_today,
    'alreadyRecorded', false
  );
END;
$function$;
