-- 2026-06-lockdown-securitydefiner-grants.sql
-- Cierra los avisos del Supabase Database Linter sobre funciones SECURITY
-- DEFINER ejecutables por anon/authenticated, más el search_path mutable de
-- increment_daily_stats. Ejecutar UNA vez en el SQL Editor de Supabase.
--
-- POR QUÉ hace falta este script si los SQL originales ya hacían
-- `REVOKE ALL ... FROM PUBLIC`:
--   Supabase aplica `ALTER DEFAULT PRIVILEGES` para conceder EXECUTE sobre
--   cualquier función nueva del esquema public DIRECTAMENTE a los roles `anon`
--   y `authenticated`. Revocar de `PUBLIC` (el pseudo-rol) NO elimina esos
--   grants directos, así que el linter las sigue marcando. Hay que revocar
--   explícitamente de anon y authenticated.
--
-- IMPORTANTE: solo se tocan funciones que se invocan SIEMPRE desde el servidor
-- con service_role (o que ya no se invocan). service_role conserva su EXECUTE
-- (no lo revocamos), así que crons, validate-guess y los handlers admin siguen
-- funcionando. Las RPC realmente públicas (get_monthly_leaderboard,
-- get_my_monthly_rank, get_public_profile, increment_feature_event,
-- persist_achievement_unlocks, record_daily_result_v2) NO se tocan: su grant a
-- anon/authenticated es intencional.

-- ============================================================================
-- 1) search_path mutable — increment_daily_stats
-- ============================================================================
-- El cuerpo ya cualifica todo como public.daily_stats, así que fijar el
-- search_path no cambia el comportamiento, solo elimina el vector de
-- search_path hijacking en una función SECURITY DEFINER. ALTER en vez de
-- recrear el cuerpo: menos superficie de error.
ALTER FUNCTION public.increment_daily_stats(date, boolean, integer)
  SET search_path = public;

-- ============================================================================
-- 2) Funciones SECURITY DEFINER solo-servidor: revocar EXECUTE a clientes
-- ============================================================================
-- Stats agregadas: las escribe api/validate-guess.js con service_role.
REVOKE EXECUTE ON FUNCTION public.increment_daily_stats(date, boolean, integer)
  FROM anon, authenticated;

-- DDA / dificultad: las disparan el cron warm-daily y los handlers admin con
-- service_role. Nunca desde el cliente.
REVOKE EXECUTE ON FUNCTION public.get_global_difficulty(real, real, real, real, real, real)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_car_difficulty(real, real, real, real, integer, real, real, real, real)
  FROM anon, authenticated;

-- Ranking mensual (escritura): las dispara el cron monthly-podium (service_role)
-- o el admin desde el SQL editor. Ya revocaban de PUBLIC; añadimos los roles.
REVOKE EXECUTE ON FUNCTION public.compute_monthly_podium(date, integer)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.snapshot_previous_month_podium()
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.backfill_monthly_podiums(integer)
  FROM anon, authenticated;

-- Legacy: record_daily_win() quedó superseded por record_daily_result_v2 y ya
-- no se llama desde ningún sitio del código. La blindamos por si acaso.
-- (Si confirmas que no la usa nada externo, puedes DROP FUNCTION en su lugar.)
REVOKE EXECUTE ON FUNCTION public.record_daily_win()
  FROM anon, authenticated;

-- ============================================================================
-- 3) auth_leaked_password_protection — NO ACCIONABLE en el plan actual
-- ============================================================================
-- El chequeo contra HaveIBeenPwned es una feature de pago (Supabase Pro+), no
-- disponible en free tier. Este aviso queda como WARN aceptado mientras el
-- proyecto siga en free. Además solo aplicaría al registro con email+password;
-- con login por Google OAuth es irrelevante en la práctica.
