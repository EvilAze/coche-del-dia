-- 2026-08-lockdown-securitydefiner-grants-v2.sql
-- Segunda pasada del lockdown de 2026-06-lockdown-securitydefiner-grants.sql:
-- el mismo aviso del Database Linter (funciones SECURITY DEFINER ejecutables
-- por anon/authenticated) ha reaparecido sobre CUATRO funciones que aquel
-- script no cubría, todas ellas cron/admin puras.
--
-- POR QUÉ REAPARECE si ya se cerró en junio: cada una de estas cuatro se
-- recreó DESPUÉS del lockdown de junio —con `create or replace` o con
-- `drop function` + `create`— y sus scripts de origen solo hacían
-- `REVOKE ALL ... FROM PUBLIC`. Como explica el script de junio, Supabase
-- concede EXECUTE a `anon`/`authenticated` DIRECTAMENTE (vía
-- `ALTER DEFAULT PRIVILEGES`) sobre cualquier función nueva del esquema
-- public; revocar de PUBLIC no toca esos grants directos. Recrear la función
-- —aunque sea con el mismo cuerpo— dispara ese auto-grant otra vez:
--
--   · close_finished_seasons()             — creada en 2026-07-temporadas.sql
--   · compute_season_podium(uuid, int)     — creada en 2026-07-temporadas.sql
--   · snapshot_daily_ranks()               — recreada (CREATE OR REPLACE) en
--                                             2026-07-temporadas-flip.sql
--   · recompute_car_difficulty(8 args)     — recreada al re-ejecutar
--                                             2026-06-difficulty-observatory.sql
--                                             tras 2026-08-zoom-span-ratio.sql
--
-- Las cuatro son de un solo llamador: el cron warm-daily o el admin desde el
-- SQL editor, siempre con service_role. Ese EXECUTE no se toca.
--
-- Ejecutar UNA vez en el SQL Editor de Supabase. Idempotente (REVOKE sobre un
-- privilegio ya ausente no falla).

REVOKE EXECUTE ON FUNCTION public.close_finished_seasons()
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.compute_season_podium(uuid, int)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.snapshot_daily_ranks()
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.recompute_car_difficulty(real, real, real, real, integer, real, real, real)
  FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- COMPROBACIÓN (ejecutar a mano, no forma parte de la migración)
-- ---------------------------------------------------------------------------
-- Debe devolver 0 filas: ninguna de las cuatro con EXECUTE para anon/authenticated.
--
--   SELECT p.proname, r.rolname
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   JOIN aclexplode(p.proacl) a ON true
--   JOIN pg_roles r ON r.oid = a.grantee
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('close_finished_seasons', 'compute_season_podium',
--                        'snapshot_daily_ranks', 'recompute_car_difficulty')
--     AND r.rolname IN ('anon', 'authenticated')
--     AND a.privilege_type = 'EXECUTE';
--
-- El cron sigue pudiendo llamarlas (debe devolver 4 filas):
--
--   SELECT p.proname
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   JOIN aclexplode(p.proacl) a ON true
--   JOIN pg_roles r ON r.oid = a.grantee
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('close_finished_seasons', 'compute_season_podium',
--                        'snapshot_daily_ranks', 'recompute_car_difficulty')
--     AND r.rolname = 'service_role'
--     AND a.privilege_type = 'EXECUTE';
