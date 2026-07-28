-- scripts/2026-07-rls-anonimos-fuera-de-la-tabla.sql
-- ---------------------------------------------------------------------------
-- EL ANÓNIMO JUEGA, PERO NO FIRMA
--
-- Ejecutar ANTES (o a la vez que) activar «Anonymous sign-ins» en el dashboard.
--
-- EL PROBLEMA. Una sesión anónima de Supabase entra con el rol `authenticated`,
-- exactamente el mismo que una cuenta registrada. Hereda por tanto todas las
-- policies escritas para ese rol — incluidas «profiles own insert» y «profiles
-- own update», que solo comprueban `auth.uid() = id`.
--
-- Consecuencia: un anónimo podría escribir su `display_name` llamando a la API
-- directamente. Y como las funciones de temporada arman la tabla filtrando por
-- `WHERE p.display_name IS NOT NULL`, eso es exactamente lo que hace falta para
-- salir en la clasificación. La interfaz nunca le ofrece elegir firma (el modal
-- del nick solo aparece con cuenta real), pero la interfaz no es la frontera de
-- seguridad: lo es el RLS (regla 4).
--
-- Antes de las sesiones anónimas esto no existía como agujero, porque para
-- tener rol `authenticated` había que registrarse de verdad.
--
-- LA SOLUCIÓN. Dos policies RESTRICTIVE sobre profiles. Restrictive y no
-- permissive a propósito: las permisivas se combinan con OR (basta que UNA
-- deje pasar), mientras que las restrictivas se combinan con AND — ninguna otra
-- policy, presente o futura, puede saltarse esta condición.
--
-- Quirúrgicas: el anónimo SÍ puede tener fila en profiles (hoy no la crea, pero
-- no queremos cerrar esa puerta a futuro); lo único que no puede es ponerle
-- firma. En cuanto vincula su cuenta con Google o correo deja de ser anónimo,
-- su JWT se renueva sin el claim y puede elegir nick como cualquiera — que es
-- justo el flujo que queremos premiar.
--
-- `IS NOT TRUE` y no `= false` a propósito: si el claim `is_anonymous` faltara
-- en algún token (versión antigua, refresco raro), la comparación daría NULL y
-- `= false` bloquearía a un usuario legítimo. `IS NOT TRUE` trata el NULL como
-- "no es anónimo": falla del lado de dejar jugar al registrado, nunca del de
-- colar al anónimo, porque para colarse haría falta un claim TRUE explícito.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS profiles_anonimo_sin_firma_insert ON public.profiles;
CREATE POLICY profiles_anonimo_sin_firma_insert ON public.profiles
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (
    display_name IS NULL
    OR (SELECT (auth.jwt() ->> 'is_anonymous')::boolean) IS NOT TRUE
  );

DROP POLICY IF EXISTS profiles_anonimo_sin_firma_update ON public.profiles;
CREATE POLICY profiles_anonimo_sin_firma_update ON public.profiles
  AS RESTRICTIVE
  FOR UPDATE TO authenticated
  WITH CHECK (
    display_name IS NULL
    OR (SELECT (auth.jwt() ->> 'is_anonymous')::boolean) IS NOT TRUE
  );

-- ---------------------------------------------------------------------------
-- LO QUE EL ANÓNIMO SÍ PUEDE, Y DEBE PODER
--
-- No se toca nada de esto: es el contenido de la función.
--   · user_guesses  → escribe sus intentos (es lo que le da racha y Archivo).
--   · stats         → las escribe record_daily_result_v2, que es SECURITY
--                     DEFINER y corre como owner; RLS ni entra.
--   · achievements  → suyos, por user_id.
--
-- Y no puede, sin necesidad de policy nueva:
--   · Salir en la clasificación: sin display_name, las funciones de temporada
--     lo descartan solas.
-- ---------------------------------------------------------------------------

-- Comprobación: lista las policies de profiles con su tipo (PERMISSIVE /
-- RESTRICTIVE). Las dos de arriba deben salir como RESTRICTIVE.
--   SELECT policyname, permissive, cmd
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'profiles'
--   ORDER BY policyname;
