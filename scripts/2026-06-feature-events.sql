-- scripts/2026-06-feature-events.sql
-- Contador agregado de "palancas" de UI: cuánto se usa cierta acción del
-- cliente (¿se abre el ranking?, ¿se usa la repesca?, etc.). Mismo patrón que
-- daily_stats: tabla de contadores + RPC SECURITY DEFINER que el cliente
-- llama directamente.
--
-- ¿Por qué RPC y no un endpoint /api? Porque estamos al límite de funciones
-- serverless de Vercel (~12) y porque la API de Umami —donde ya registramos
-- el evento— es de pago, así que el panel admin no puede leer de ahí. Una RPC
-- SECURITY DEFINER escribe el contador SIN conceder GRANT de escritura al rol
-- del cliente (corre como owner), respetando el hardening de "nada de
-- escrituras directas de cliente a tablas".
--
-- Ejecutar UNA vez en el SQL editor de Supabase (idempotente).

CREATE TABLE IF NOT EXISTS public.feature_events (
  event text    NOT NULL,                 -- p.ej. 'ranking_open'
  date  date    NOT NULL,                 -- fecha Madrid de la pulsación
  auth  text    NOT NULL DEFAULT 'anon',  -- 'user' | 'anon'
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (event, date, auth)
);

-- RLS deny-all: activado y SIN policies → anon/authenticated no pueden leer ni
-- escribir directamente. service_role (panel admin/analytics) lo salta. La
-- ÚNICA vía de escritura es la RPC de abajo.
ALTER TABLE public.feature_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.feature_events FROM PUBLIC;
REVOKE ALL ON TABLE public.feature_events FROM anon;
REVOKE ALL ON TABLE public.feature_events FROM authenticated;

-- RPC atómica de incremento. SECURITY DEFINER → ejecuta con privilegios de
-- owner, por eso puede escribir aunque el caller (anon/authenticated) no tenga
-- GRANT sobre la tabla.
--
-- ALLOWLIST de eventos: un cliente no fiable podría llamar con nombres
-- arbitrarios e inflar la tabla con filas basura. Solo aceptamos eventos
-- conocidos; cualquier otro es no-op. Para añadir una palanca nueva, amplía
-- el IN (...) — nada más.
CREATE OR REPLACE FUNCTION public.increment_feature_event(p_event text, p_auth text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event text := left(coalesce(p_event, ''), 60);
  v_auth  text := CASE WHEN p_auth = 'user' THEN 'user' ELSE 'anon' END;
BEGIN
  IF v_event NOT IN ('ranking_open') THEN
    RETURN; -- evento no permitido: no-op (defensa contra spam de nombres)
  END IF;

  INSERT INTO public.feature_events (event, date, auth, count)
  VALUES (v_event, (now() AT TIME ZONE 'Europe/Madrid')::date, v_auth, 1)
  ON CONFLICT (event, date, auth)
  DO UPDATE SET count = feature_events.count + 1;
END;
$$;

-- Ejecutable desde el cliente (anon y authenticated). Es lo único que pueden
-- tocar: insertar/actualizar el contador vía la función controlada.
REVOKE ALL ON FUNCTION public.increment_feature_event(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_feature_event(text, text) TO anon, authenticated;

-- Verificación (READ-ONLY): RLS activado y sin policies (deny-all).
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'feature_events';
SELECT polname FROM pg_policy
  WHERE polrelid = 'public.feature_events'::regclass;  -- esperado: 0 filas
