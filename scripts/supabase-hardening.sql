-- scripts/supabase-hardening.sql
--
-- Auditoría y blindaje de Supabase para Carguessr.
-- Ejecuta CADA bloque por separado en el SQL Editor de Supabase. Cada uno
-- está marcado con su propósito:
--
--   [A] = consulta de inspección (read-only, no cambia nada)
--   [B] = hardening (CAMBIA permisos — léelo antes de ejecutar)
--   [C] = patch de función (CAMBIA código SQL — léelo antes de ejecutar)
--
-- IDEM: cada bloque es idempotente. Puedes volver a correrlo sin romper.
-- Si cualquier bloque [A] devuelve algo "raro", para y comprueba antes de
-- pasar al siguiente.

-- ===========================================================================
-- [A.1] ¿Qué tablas tenemos y qué RLS está activado?
-- ===========================================================================
-- Esperado: rls_enabled = true en TODAS las tablas con datos de usuarios
-- (user_guesses, stats, profiles). Si alguna está en false → ALERTA ROJA.
--
-- Nota: usamos pg_class porque en versiones de Postgres anteriores a 17 la
-- vista pg_tables no expone `forcerowsecurity` (sí `rowsecurity`). Con
-- pg_class tenemos ambas columnas y funciona en cualquier versión.
SELECT
  n.nspname            AS schemaname,
  c.relname            AS tablename,
  c.relrowsecurity     AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'   -- 'r' = tabla normal
ORDER BY c.relname;

-- ===========================================================================
-- [A.2] Policies actuales por tabla
-- ===========================================================================
-- Para cada tabla, lista qué roles pueden hacer SELECT/INSERT/UPDATE/DELETE.
--
-- Lo que queremos ver:
--   user_guesses:
--     - SELECT permitido para authenticated (con WHERE user_id = auth.uid())
--     - INSERT/UPDATE/DELETE NO permitidos para authenticated (los hace
--       service_role desde validate-guess / repesca/validate).
--   stats:
--     - SELECT permitido para authenticated (público, sí; el ranking lo lee
--       cualquiera) o anon. Cualquier WHERE clause es OK.
--     - INSERT/UPDATE/DELETE NO permitidos para authenticated.
--   daily_cars:
--     - Idealmente NINGUNA policy para authenticated/anon — todas las lecturas
--       deben pasar por endpoints server-side con service_role.
--   cars:
--     - SELECT permitido para anon/authenticated SIN exponer image_url ni
--       description (eso lo controla el endpoint /api/list-cars haciendo
--       .select() explícito, pero conviene también restringir desde RLS).
SELECT
  schemaname,
  tablename,
  policyname,
  cmd AS command,         -- SELECT / INSERT / UPDATE / DELETE / ALL
  roles,                  -- {public}, {anon}, {authenticated}, etc.
  qual AS using_expr,     -- expresión USING
  with_check AS check_expr
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- ===========================================================================
-- [A.3] Funciones RPC: ¿quién las puede ejecutar?
-- ===========================================================================
-- Lo que queremos ver:
--   record_daily_result_v2 → prosecdef = true (SECURITY DEFINER)
--   pick_daily_car         → debe estar revocada para anon/authenticated.
--                            Solo service_role la llama desde nuestros endpoints.
--
-- proacl muestra los GRANTs. Si está NULL, usa los defaults de Postgres
-- (EXECUTE para PUBLIC) → MAL: quiere decir que cualquiera puede llamarla.
SELECT
  n.nspname AS schema,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  p.prosecdef AS security_definer,
  p.proacl AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('record_daily_result_v2', 'pick_daily_car')
ORDER BY p.proname;

-- ===========================================================================
-- [A.4] Cuerpo actual de record_daily_result_v2 (para auditar la lógica)
-- ===========================================================================
-- Lee esto a mano y comprueba que:
--   1. Es SECURITY DEFINER.
--   2. Hace auth.uid() y rechaza si NULL.
--   3. NO confía en p_attempt_number — debería recalcularlo desde
--      user_guesses (o al menos validar consistencia con el status real).
--   4. Es idempotente (no suma dos veces si llamas dos veces el mismo día).
SELECT pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'record_daily_result_v2';

-- ===========================================================================
-- [A.5] Cuerpo de pick_daily_car
-- ===========================================================================
SELECT pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'pick_daily_car';


-- ###########################################################################
-- HARDENING — corre cada bloque [B.x] sólo si [A.x] mostró que aplica.
-- ###########################################################################

-- ===========================================================================
-- [B.1] Revoca EXECUTE de pick_daily_car a anon/authenticated
-- ===========================================================================
-- Si en [A.3] proacl es NULL o incluye =X/postgres para PUBLIC, esta
-- función la puede llamar cualquiera con la SDK del frontend. Bloqueamos.
REVOKE EXECUTE ON FUNCTION public.pick_daily_car(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pick_daily_car(date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pick_daily_car(date) FROM authenticated;
-- service_role la sigue pudiendo llamar porque es superusuario virtual.

-- ===========================================================================
-- [B.2] Revoca INSERT/UPDATE/DELETE de user_guesses a authenticated
-- ===========================================================================
-- Si en [A.2] hay policies INSERT/UPDATE/DELETE para authenticated en
-- user_guesses, hay que DROPearlas. Los nombres dependen de cómo se hayan
-- creado; ajústalos según [A.2]. Ejemplos comunes:
--
-- DROP POLICY IF EXISTS "user_guesses_insert"  ON public.user_guesses;
-- DROP POLICY IF EXISTS "user_guesses_update"  ON public.user_guesses;
-- DROP POLICY IF EXISTS "user_guesses_delete"  ON public.user_guesses;
--
-- También quitamos los GRANTs base (RLS no aplica si no hay GRANT primero).
REVOKE INSERT, UPDATE, DELETE ON public.user_guesses FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_guesses FROM anon;
-- SELECT lo dejamos: la home logueada lee el progreso del usuario con su
-- bearer. La policy SELECT debe filtrar WHERE user_id = auth.uid().

-- ===========================================================================
-- [B.3] Revoca INSERT/UPDATE/DELETE de stats a authenticated/anon
-- ===========================================================================
-- Igual que [B.2]. Todas las mutaciones sobre stats viven server-side
-- (validate-guess via record_daily_result_v2, repesca/start, repesca/validate).
-- DROP POLICY IF EXISTS "stats_insert" ON public.stats;
-- DROP POLICY IF EXISTS "stats_update" ON public.stats;
-- DROP POLICY IF EXISTS "stats_delete" ON public.stats;

REVOKE INSERT, UPDATE, DELETE ON public.stats FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.stats FROM anon;
-- SELECT lo mantenemos: el ranking lo lee cualquiera.

-- ===========================================================================
-- [B.4] daily_cars: bloqueo total para cliente
-- ===========================================================================
-- daily_cars contiene "qué coche tocó cada día". Filtrarlo al cliente
-- destruye el juego de las próximas jornadas (si hay coches pre-asignados)
-- o del histórico (si el cheater cruza fechas pasadas con list-cars).
REVOKE ALL ON public.daily_cars FROM authenticated;
REVOKE ALL ON public.daily_cars FROM anon;
-- (service_role bypasea RLS, sigue accediendo desde nuestros endpoints).

-- ===========================================================================
-- [B.5] cars: image_url y description SÓLO para service_role
-- ===========================================================================
-- /api/list-cars usa supabase con ANON_KEY y hace .select('id, make, model, ...')
-- omitiendo image_url. Pero si alguna policy permite SELECT sin filtrar
-- columnas, un atacante puede pedir image_url. Conviene mirarlo.
--
-- Una solución elegante sin tocar policies: crear una VIEW pública con sólo
-- las columnas no sensibles, y forzar al frontend a usar la vista.
-- (Más invasivo de lo que necesitamos hoy; lo dejo apuntado.)

-- Si solo quieres reforzar sin meter views, puedes hacer SELECT por columnas
-- a través de policies más restrictivas. Postgres no soporta column-level
-- policies directamente, pero sí column GRANTs:
REVOKE SELECT ON public.cars FROM authenticated;
REVOKE SELECT ON public.cars FROM anon;
GRANT SELECT (id, make, model, year, pais) ON public.cars TO authenticated, anon;
-- Tras esto, una query con .select('*') falla; pero .select('id, make, ...')
-- (lo que ya hace list-cars) sigue funcionando.
-- IMPORTANTE: si tu /api/garage.js o algún script depende de SELECT con
-- image_url o description vía cliente, lo romperás. Sólo los endpoints que
-- usan supabaseAdmin (service_role) podrán leer esas columnas.
-- Revisa la app después de aplicarlo.


-- ###########################################################################
-- [C] PATCH de record_daily_result_v2 — ejecuta SÓLO si [A.4] muestra
--     que la función confía ciegamente en p_attempt_number.
-- ###########################################################################
--
-- Estrategia: ignorar p_attempt_number del caller y derivarlo del estado
-- real de user_guesses. Si el caller dice p_won=true pero user_guesses no
-- tiene esa partida en status='won', rechazamos.
--
-- TEMPLATE: ajústalo a tu implementación actual. Mantén el resto de la
-- lógica de scoring/streak que ya tengas; aquí mostramos sólo la parte
-- de validación. Compara con el cuerpo que devolvió [A.4].
--
-- CREATE OR REPLACE FUNCTION public.record_daily_result_v2(
--   p_won boolean,
--   p_attempt_number integer  -- IGNORADO: se recalcula server-side
-- )
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
-- DECLARE
--   v_uid      uuid := auth.uid();
--   v_today    date := (now() AT TIME ZONE 'Europe/Madrid')::date;
--   v_car_id   uuid;
--   v_attempts int;
--   v_status   text;
-- BEGIN
--   IF v_uid IS NULL THEN
--     RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
--   END IF;
--
--   SELECT car_id INTO v_car_id
--   FROM public.daily_cars
--   WHERE date = v_today;
--
--   IF v_car_id IS NULL THEN
--     RAISE EXCEPTION 'No daily car for today';
--   END IF;
--
--   -- Verdad autoritativa de user_guesses: cuántos intentos hizo y status.
--   SELECT COALESCE(jsonb_array_length(guesses), 0), status
--   INTO v_attempts, v_status
--   FROM public.user_guesses
--   WHERE user_id = v_uid AND car_id = v_car_id AND date = v_today;
--
--   IF v_status IS NULL THEN
--     RAISE EXCEPTION 'No game state to record';
--   END IF;
--
--   -- p_won debe coincidir con el status REAL almacenado server-side.
--   IF p_won AND v_status <> 'won' THEN
--     RAISE EXCEPTION 'Win mismatch';
--   END IF;
--   IF NOT p_won AND v_status NOT IN ('won', 'lost') THEN
--     RAISE EXCEPTION 'Game not finished';
--   END IF;
--
--   -- ... a partir de aquí, el cuerpo original (idempotencia, scoring,
--   --     streaks, etc.), usando v_attempts en lugar de p_attempt_number.
--
--   RETURN jsonb_build_object(
--     'basePoints', /* ... */,
--     'streakBonus', /* ... */,
--     'totalPoints', /* ... */,
--     'currentStreak', /* ... */,
--     'maxStreak', /* ... */,
--     'totalScore', /* ... */,
--     'alreadyRecorded', /* ... */
--   );
-- END;
-- $$;


-- ###########################################################################
-- [A.6] POST-CHECK: vuelve a correr esto tras [B.x] / [C] para confirmar
-- ###########################################################################
SELECT
  schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

SELECT
  schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;

-- Esperado tras hardening:
--   user_guesses: solo policies de SELECT con WHERE user_id = auth.uid()
--   stats:        solo policies de SELECT
--   daily_cars:   sin policies o con todas restrictivas
--   profiles:     SELECT pública (para el ranking) + INSERT/UPDATE propio
