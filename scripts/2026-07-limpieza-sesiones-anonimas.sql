-- scripts/2026-07-limpieza-sesiones-anonimas.sql
-- ---------------------------------------------------------------------------
-- LIMPIEZA DE SESIONES ANÓNIMAS CADUCADAS
--
-- Desde jul-2026 el jugador que envía su primer intento recibe una sesión
-- anónima de Supabase (auth.users con is_anonymous = true). Eso es lo que le da
-- racha, estadísticas y Archivo sin registrarse, y lo que permite que al entrar
-- con Google/correo CONSERVE todo (se vincula la identidad al mismo user id).
--
-- El precio: esas filas no se borran solas. Supabase no tiene limpieza
-- automática y su guía recomienda justo esto — una consulta programada. Sin
-- ella, auth.users crece indefinidamente y cada fila cuenta para el MAU
-- (50.000 en el plan gratuito; sobra sitio, pero la basura se acumula igual).
--
-- CRITERIO: se borran las sesiones anónimas SIN ACTIVIDAD en 30 días. No basta
-- con mirar created_at: un jugador anónimo fiel puede llevar meses con la misma
-- sesión y su racha vive ahí. Miramos `last_sign_in_at` (y caemos a created_at
-- si nunca se refrescó), y además protegemos a quien tenga partidas recientes.
--
-- CÓMO PROGRAMARLO: en el dashboard de Supabase, Database → Cron (pg_cron),
-- una vez al día. O a mano de vez en cuando; no es urgente.
--
--   SELECT cron.schedule(
--     'limpieza-anonimos',
--     '0 4 * * *',
--     $$ SELECT public.limpiar_sesiones_anonimas(30); $$
--   );
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.limpiar_sesiones_anonimas(p_dias int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_borradas int;
BEGIN
  WITH candidatas AS (
    SELECT u.id
    FROM auth.users u
    WHERE u.is_anonymous = true
      -- Sin actividad en la ventana. COALESCE porque last_sign_in_at puede ser
      -- NULL si la sesión nunca se renovó tras crearse.
      AND COALESCE(u.last_sign_in_at, u.created_at) < now() - make_interval(days => p_dias)
      -- Red de seguridad: nunca borrar a quien tenga una partida reciente,
      -- aunque su token no se haya refrescado. La racha es lo único que este
      -- usuario tiene y perderla sería justo el daño que evitamos.
      AND NOT EXISTS (
        SELECT 1 FROM public.user_guesses g
        WHERE g.user_id = u.id
          AND g.date > (now() - make_interval(days => p_dias))::date
      )
  )
  DELETE FROM auth.users
  WHERE id IN (SELECT id FROM candidatas);

  GET DIAGNOSTICS v_borradas = ROW_COUNT;
  RETURN v_borradas;
END;
$$;

-- Solo el owner / service_role la ejecuta. Ni anon ni authenticated tienen nada
-- que hacer aquí (misma política que el resto de SECURITY DEFINER del proyecto,
-- ver 2026-06-lockdown-securitydefiner-grants.sql).
REVOKE ALL ON FUNCTION public.limpiar_sesiones_anonimas(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.limpiar_sesiones_anonimas(int) FROM anon;
REVOKE ALL ON FUNCTION public.limpiar_sesiones_anonimas(int) FROM authenticated;

-- Comprobación en seco antes de programarla: cuántas se borrarían hoy.
--   SELECT count(*) FROM auth.users u
--   WHERE u.is_anonymous = true
--     AND COALESCE(u.last_sign_in_at, u.created_at) < now() - interval '30 days';
