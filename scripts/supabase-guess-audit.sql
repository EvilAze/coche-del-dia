-- scripts/supabase-guess-audit.sql
-- Tabla de auditoría OCULTA de intentos. Objetivo: detectar el patrón de
-- "oráculo" (la misma persona sondea el coche de hoy desde una sesión
-- paralela —incógnito u otra cuenta— y luego lo gana a la primera con su
-- cuenta real).
--
-- VISIBILIDAD: solo el dueño (service_role / dashboard) puede leerla.
--   - RLS ACTIVADO y SIN NINGUNA policy → los roles `anon` y `authenticated`
--     no pueden ver ni una fila (RLS sin policy = deny-all).
--   - Además REVOKE explícito de todos los privilegios sobre la tabla y la
--     secuencia para anon/authenticated/public, así PostgREST ni la expone.
--   - service_role salta RLS por diseño → tus scripts e inserts server-side
--     (getSupabaseAdmin) sí funcionan.
--   La columna ip se guarda HASHEADA (HMAC con REPESCA_TOKEN_SECRET), nunca
--   en claro: suficiente para correlacionar sesiones sin almacenar PII cruda.

CREATE TABLE IF NOT EXISTS public.guess_audit (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts             timestamptz  NOT NULL DEFAULT now(),
  mode           text         NOT NULL,            -- 'daily' | 'repesca'
  game_date      text         NOT NULL,            -- fecha Madrid YYYY-MM-DD
  car_id         uuid         NOT NULL,            -- coche objetivo (real)
  user_id        uuid,                             -- null si anónimo
  is_anon        boolean      NOT NULL,
  anon_n         integer,                          -- contador de la cookie anon
  attempt_number integer      NOT NULL,
  ip_hash        text,                             -- HMAC-SHA256(ip)
  ua             text,                             -- user-agent (recortado)
  accept_lang    text,
  guess_make     text,
  guess_model    text,
  guess_year     integer,
  marca_status   text,                             -- correct|partial|wrong
  modelo_status  text,
  anio_status    text,
  win            boolean      NOT NULL,
  note           text                              -- motivo en eventos 'canary'
);

-- Idempotente: si la tabla ya existía de una ejecución previa, añade la
-- columna 'note' (usada por los eventos canary de daily-image).
ALTER TABLE public.guess_audit ADD COLUMN IF NOT EXISTS note text;

-- Índices para las consultas de auditoría: correlación por (ip_hash, día) y
-- listados por usuario.
CREATE INDEX IF NOT EXISTS idx_guess_audit_ip_day
  ON public.guess_audit (game_date, ip_hash);
CREATE INDEX IF NOT EXISTS idx_guess_audit_user
  ON public.guess_audit (user_id, ts);
CREATE INDEX IF NOT EXISTS idx_guess_audit_car_day
  ON public.guess_audit (game_date, car_id);

-- RLS deny-all: activado, sin policies. Nadie con rol anon/authenticated
-- puede leer ni escribir. service_role lo salta.
ALTER TABLE public.guess_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guess_audit FORCE ROW LEVEL SECURITY;

-- Defensa en profundidad: revoca cualquier privilegio heredado vía PUBLIC.
REVOKE ALL ON TABLE public.guess_audit FROM PUBLIC;
REVOKE ALL ON TABLE public.guess_audit FROM anon;
REVOKE ALL ON TABLE public.guess_audit FROM authenticated;

-- Verificación (READ-ONLY): debe salir rowsecurity = true y sin policies.
SELECT relname, relrowsecurity, relforcerowsecurity
  FROM pg_class WHERE relname = 'guess_audit';
SELECT polname FROM pg_policy
  WHERE polrelid = 'public.guess_audit'::regclass;  -- esperado: 0 filas
