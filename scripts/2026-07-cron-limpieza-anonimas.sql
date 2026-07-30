-- scripts/2026-07-cron-limpieza-anonimas.sql
-- ---------------------------------------------------------------------------
-- PROGRAMA la limpieza de sesiones anónimas que 2026-07-limpieza-sesiones-anonimas.sql
-- dejó solo DEFINIDA. Aquel script creó `limpiar_sesiones_anonimas(int)` y anotó
-- en un comentario cómo programarla… y ahí se quedó: nunca se ejecutó el
-- cron.schedule. Consecuencia medida el 31-jul-2026 — las filas anónimas de
-- auth.users se acumulan sin tope y el KPI «Sesiones anónimas» del panel deriva
-- hacia arriba para siempre, igual que le pasaba al denominador de la repesca.
--
-- POR QUÉ pg_cron Y NO UN CRON DE VERCEL: el plan Hobby limita los cron jobs y
-- ya gastamos el presupuesto en warm-daily (ver vercel.json). Además esto es una
-- sentencia SQL contra la propia base — meterla en una Serverless Function sería
-- añadir un endpoint, un CRON_SECRET y un despliegue para no ganar nada. Es la
-- vía que recomienda la guía de Supabase y la que ya anotaba el script original.
--
-- Aplicar en el SQL editor de Supabase, DESPUÉS de
-- scripts/2026-07-limpieza-sesiones-anonimas.sql. Idempotente: se puede
-- re-ejecutar sin duplicar el job.
-- ---------------------------------------------------------------------------

-- pg_cron vive en el esquema `cron`. En Supabase se habilita desde Database →
-- Extensions, pero lo dejamos explícito para que este script funcione de una
-- sola pasada en un proyecto nuevo.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotencia: cron.schedule con un nombre ya existente ACTUALIZA el job en
-- versiones recientes de pg_cron, pero en otras lanza. Desprogramar primero es
-- la única forma que se comporta igual en todas. `cron.unschedule` lanza si el
-- job no existe, así que lo envolvemos: en la primera ejecución no hay nada que
-- quitar y eso NO es un error.
DO $$
BEGIN
  PERFORM cron.unschedule('limpieza-anonimos');
EXCEPTION
  WHEN OTHERS THEN NULL;  -- no existía; es el caso normal la primera vez
END $$;

-- 04:00 UTC: fuera de la ventana de juego (el corte del día es medianoche en
-- Madrid) y lejos de warm-daily (23:05), para no solapar carga.
--
-- 30 días de gracia, el default de la función. No es un número tímido: la
-- sesión anónima es lo ÚNICO donde vive la racha de un jugador no registrado,
-- y la función además protege a quien tenga partidas recientes aunque su token
-- lleve meses sin refrescarse.
SELECT cron.schedule(
  'limpieza-anonimos',
  '0 4 * * *',
  $$ SELECT public.limpiar_sesiones_anonimas(30); $$
);

-- ---------------------------------------------------------------------------
-- COMPROBACIONES (ejecutar a mano, no forman parte de la migración)
-- ---------------------------------------------------------------------------
-- ¿Quedó programado?
--   SELECT jobid, schedule, command, active
--   FROM cron.job WHERE jobname = 'limpieza-anonimos';
--
-- ¿Cuántas borraría HOY? (en seco, sin tocar nada)
--   SELECT count(*) FROM auth.users u
--   WHERE u.is_anonymous = true
--     AND COALESCE(u.last_sign_in_at, u.created_at) < now() - interval '30 days';
--
-- Últimas ejecuciones, para confirmar que corre de verdad:
--   SELECT start_time, status, return_message
--   FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'limpieza-anonimos')
--   ORDER BY start_time DESC LIMIT 10;
