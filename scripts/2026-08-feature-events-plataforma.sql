-- scripts/2026-08-feature-events-plataforma.sql
-- Añade la dimensión PLATAFORMA (app | web) al contador `feature_events` y un
-- evento nuevo, `sesion`, para poder pintar en el panel admin cuánta gente
-- entra desde la app de Play y cuánta desde el navegador.
--
-- POR QUÉ HACÍA FALTA. El panel de Analítica lee SOLO de Supabase, y hasta
-- ahora la plataforma no llegaba a Postgres por ningún sitio: se calcula en el
-- cliente (src/lib/plataforma.js) y viaja únicamente a Umami como propiedad de
-- evento y a Sentry como tag. Consecuencia: todos los números del panel
-- —partidas, jugadores, dificultad— son la suma app+web, mezclada y sin forma
-- de separarla a posteriori. El único rastro en la base era el user-agent de
-- guess_audit, y ya hubo que deducir la plataforma de ahí a mano (12-ago-2026).
--
-- POR QUÉ AQUÍ Y NO EN UMAMI. Umami ya separa por plataforma, pero su API es
-- de pago y el panel no puede leer de ahí. Mismo razonamiento que trajo
-- feature_events en 2026-06 (ver scripts/2026-06-feature-events.sql).
--
-- POR QUÉ UN EVENTO NUEVO Y NO REUSAR `ranking_open`. Se quiere medir accesos,
-- no el uso de una palanca concreta: quien entra y no abre el ranking también
-- cuenta. `sesion` se dispara UNA VEZ por dispositivo y día (el cliente guarda
-- la fecha Madrid en localStorage), así que el contador se lee como
-- "dispositivos activos por día y plataforma" ≈ DAU partido app/web, anónimos
-- incluidos. NO son personas únicas: dos navegadores del mismo humano son dos.
--
-- Ejecutar UNA vez en el SQL editor de Supabase. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) La columna
-- ---------------------------------------------------------------------------
-- DEFAULT 'legacy' y no 'web' A PROPÓSITO: las filas que ya existen son de
-- `ranking_open` de antes de esta migración y contienen pulsaciones de app y de
-- web mezcladas. Etiquetarlas 'web' sería inventarse un dato; 'legacy' dice la
-- verdad, que es "no se sabe", y deja las series limpias desde hoy.
ALTER TABLE public.feature_events
  ADD COLUMN IF NOT EXISTS plataforma text NOT NULL DEFAULT 'legacy';

-- La clave primaria pasa a incluir la plataforma, o el ON CONFLICT de la RPC
-- sumaría app y web en la misma fila. Drop + add para que el script se pueda
-- reejecutar sin error.
ALTER TABLE public.feature_events DROP CONSTRAINT IF EXISTS feature_events_pkey;
ALTER TABLE public.feature_events
  ADD CONSTRAINT feature_events_pkey PRIMARY KEY (event, date, auth, plataforma);

-- ---------------------------------------------------------------------------
-- 2) La RPC
-- ---------------------------------------------------------------------------
-- DROP + CREATE en vez de CREATE OR REPLACE, y no es cosmético: añadir un
-- tercer parámetro (aunque lleve DEFAULT) NO reemplaza la función, crea una
-- SOBRECARGA. Con las dos vivas, una llamada de dos argumentos —las de los
-- APKs ya instalados— queda AMBIGUA y Postgres la rechaza: se perderían los
-- contadores de todo el que no haya actualizado. Con una sola función que
-- tiene el tercer parámetro por defecto, esas llamadas siguen entrando y caen
-- en 'legacy', que es exactamente lo que son: plataforma desconocida.
DROP FUNCTION IF EXISTS public.increment_feature_event(text, text);
DROP FUNCTION IF EXISTS public.increment_feature_event(text, text, text);

CREATE FUNCTION public.increment_feature_event(
  p_event      text,
  p_auth       text,
  p_plataforma text DEFAULT 'legacy'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event text := left(coalesce(p_event, ''), 60);
  v_auth  text := CASE WHEN p_auth = 'user' THEN 'user' ELSE 'anon' END;
  -- Allowlist también en la plataforma: el cliente no es de fiar y sin esto
  -- podría abrir filas nuevas con cualquier cadena y ensuciar el reparto.
  v_plat  text := CASE
                    WHEN p_plataforma = 'app' THEN 'app'
                    WHEN p_plataforma = 'web' THEN 'web'
                    ELSE 'legacy'
                  END;
BEGIN
  -- ALLOWLIST de eventos (misma defensa que la versión anterior). Para añadir
  -- una palanca nueva, amplía el IN (...) — nada más.
  IF v_event NOT IN ('ranking_open', 'sesion') THEN
    RETURN; -- evento no permitido: no-op
  END IF;

  INSERT INTO public.feature_events (event, date, auth, plataforma, count)
  VALUES (v_event, (now() AT TIME ZONE 'Europe/Madrid')::date, v_auth, v_plat, 1)
  ON CONFLICT (event, date, auth, plataforma)
  DO UPDATE SET count = feature_events.count + 1;
END;
$$;

-- Los GRANT se pierden con el DROP: hay que rehacerlos. Sin esto, el cliente
-- deja de contar EN SILENCIO (la llamada es fire-and-forget).
REVOKE ALL ON FUNCTION public.increment_feature_event(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_feature_event(text, text, text) TO anon, authenticated;

-- PostgREST cachea la firma de las funciones. Sin este NOTIFY, las llamadas
-- con p_plataforma responden 404 hasta que al pool le toque recargar solo.
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 3) Verificación (READ-ONLY)
-- ---------------------------------------------------------------------------
-- Esperado: una sola función, con tres argumentos.
SELECT p.oid::regprocedure AS firma, p.prosecdef AS security_definer
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'increment_feature_event';

-- Esperado: la PK con las cuatro columnas.
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'public.feature_events'::regclass AND contype = 'p';

-- Esperado: RLS activado y CERO policies (deny-all; la RPC es la única vía).
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'feature_events';
SELECT polname FROM pg_policy WHERE polrelid = 'public.feature_events'::regclass;
