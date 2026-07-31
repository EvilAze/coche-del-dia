-- scripts/supabase-streak-freeze.sql
--
-- ⚠ HISTÓRICO — RETIRADO EN AGOSTO DE 2026. NO EJECUTAR.
-- Lo sustituye scripts/2026-08-retirar-escudo-racha.sql, que devuelve
-- record_daily_result a la regla simple (consecutivo o reset). Allí está
-- explicado por qué se retiró la mecánica; este archivo se conserva solo para
-- entender qué había antes. Re-ejecutarlo la resucitaría.
--
-- STREAK FREEZE (congelado de racha): protege la racha cuando el jugador falta
-- EXACTAMENTE un día. Estilo Duolingo. Reduce el abandono "ya rompí la racha,
-- para qué vuelvo", que es el disparador #1 de churn en juegos diarios.
--
-- REGLAS:
--   - Inventario en stats.streak_freezes (todos empiezan con 1).
--   - Solo cubre AUSENCIAS, no derrotas: si juegas y fallas, la racha cae a 0
--     igual (el freeze no salva un fallo activo).
--   - Cubre un hueco de UN día (jugaste anteayer, no ayer, y hoy ganas):
--     consume 1 congelado y la racha continúa como si no hubiera hueco.
--     Hueco de 2+ días → reset normal.
--   - Se gana +1 al cruzar cada múltiplo de 10 de racha. Tope 2.
--
-- Idempotente (ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE). Re-ejecutable.

-- ============================================================================
-- 1) Columna de inventario
-- ============================================================================
-- DEFAULT 1 → las filas existentes se rellenan a 1 (todos reciben su primer
-- congelado), y los usuarios nuevos arrancan con 1.
ALTER TABLE public.stats
  ADD COLUMN IF NOT EXISTS streak_freezes int NOT NULL DEFAULT 1;

-- El cliente (getMyStats / getMyStreak) lee esta columna con la sesión del
-- propio usuario (RLS). Concedemos SELECT de la columna de forma defensiva
-- (no-op si la tabla ya tiene SELECT a nivel de tabla).
GRANT SELECT (streak_freezes) ON public.stats TO anon, authenticated;


-- ============================================================================
-- 2) record_daily_result con lógica de freeze
-- ============================================================================
-- Misma firma y mismo contrato de retorno que la versión previa + dos campos
-- nuevos: freezeUsed (bool) y streakFreezes (inventario resultante). El resto
-- (puntos base, bonus, max_streak, last_played_date) queda EXACTAMENTE igual.
-- record_daily_result_v2 (el envoltorio anti-cheat) no cambia: delega aquí.

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
  v_freeze_used  BOOLEAN := false;   -- ¿se gastó un congelado para salvar la racha?
  v_new_freezes  INTEGER;            -- inventario resultante
  v_freeze_cap   CONSTANT INTEGER := 2;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Tabla base por intento (solo si acertó)
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
      'alreadyRecorded', true,
      'freezeUsed',      false,
      'streakFreezes',   COALESCE(v_row.streak_freezes, 0)
    );
  END IF;

  -- Cálculo de racha (con streak freeze)
  IF p_won THEN
    IF v_row.last_played_date = v_yesterday AND v_row.current_streak > 0 THEN
      -- Día consecutivo: la racha continúa.
      v_new_streak := v_row.current_streak + 1;
    ELSIF v_row.last_played_date = (v_today - 2)
          AND v_row.current_streak > 0
          AND COALESCE(v_row.streak_freezes, 0) > 0 THEN
      -- Faltó EXACTAMENTE un día pero tiene congelado: lo gastamos y la racha
      -- se salva (continúa como si el hueco no existiera).
      v_new_streak  := v_row.current_streak + 1;
      v_freeze_used := true;
    ELSE
      v_new_streak := 1;  -- primer acierto, o hueco >1 día / sin congelado
    END IF;
  ELSE
    v_new_streak := 0;    -- jugar y fallar resetea (el freeze NO cubre fallos)
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

  -- Inventario de congelados: -1 si se usó este turno; +1 al cruzar cada
  -- múltiplo de 10 de racha. Acotado a [0, cap].
  v_new_freezes := COALESCE(v_row.streak_freezes, 0)
                   - (CASE WHEN v_freeze_used THEN 1 ELSE 0 END);
  IF p_won AND v_new_streak > 0 AND v_new_streak % 10 = 0 AND v_new_freezes < v_freeze_cap THEN
    v_new_freezes := v_new_freezes + 1;
  END IF;
  v_new_freezes := GREATEST(0, LEAST(v_freeze_cap, v_new_freezes));

  UPDATE public.stats SET
    current_streak   = v_new_streak,
    max_streak       = GREATEST(max_streak, v_new_streak),
    total_wins       = total_wins + CASE WHEN p_won THEN 1 ELSE 0 END,
    total_points     = total_points + v_total_today,
    last_played_date = v_today,
    streak_freezes   = v_new_freezes
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'basePoints',      v_base_points,
    'streakBonus',     v_streak_bonus,
    'totalPoints',     v_total_today,
    'currentStreak',   v_new_streak,
    'maxStreak',       GREATEST(v_row.max_streak, v_new_streak),
    'totalScore',      v_row.total_points + v_total_today,
    'alreadyRecorded', false,
    'freezeUsed',      v_freeze_used,
    'streakFreezes',   v_new_freezes
  );
END;
$function$;
