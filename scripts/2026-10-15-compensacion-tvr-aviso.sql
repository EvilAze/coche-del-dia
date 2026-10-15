-- scripts/2026-10-15-compensacion-tvr-aviso.sql
--
-- EL AVISO DE LA COMPENSACIÓN: la próxima vez que entre cada compensado, la app
-- le enseña UNA vez qué pasó y qué se le ha devuelto (CompensacionAviso.jsx).
--
-- Ejecutar DESPUÉS de 2026-10-15-compensacion-tvr-aplicar.sql. Idempotente: si
-- ya lo ejecutaste, vuelve a ejecutarlo entero para coger la versión que marca
-- el aviso al leerlo.
--
-- Por qué una marca en el servidor y no en localStorage: el aviso tiene que
-- salir una vez POR PERSONA, no por dispositivo. Quien lo lee en el móvil no
-- debe volver a encontrárselo en la web.
--
-- Por qué dos RPC y no un SELECT del cliente: la tabla es deny-all (guarda qué
-- días jugó cada cuenta). Las funciones son SECURITY DEFINER y SOLO devuelven o
-- tocan la fila de auth.uid() — nadie puede preguntar por otro.
--
-- Temporal: cuando haya pasado una semana, se quitan el componente y esto:
--   DROP FUNCTION public.mi_compensacion_tvr(); DROP FUNCTION public.compensacion_tvr_vista();

ALTER TABLE public.compensacion_tvr_20261015
  ADD COLUMN IF NOT EXISTS aviso_visto_en timestamptz;

-- Lo que el aviso necesita contar, o NULL si no hay nada que enseñar (no
-- compensado, o ya lo recibió). NULL y no error: el cliente lo pregunta a ciegas
-- a todo el que entra con sesión, y lo normal es no estar en la lista.
--
-- LEER ES GASTARLO: la misma sentencia devuelve los datos y marca el aviso como
-- entregado. Antes se marcaba al CERRAR, y eso dejaba dos huecos para verlo dos
-- veces: abierto a la vez en el móvil y en la web, o recargar sin cerrarlo. Con
-- un UPDATE … RETURNING sobre «aviso_visto_en IS NULL», Postgres serializa las
-- dos peticiones sobre la fila y solo la primera la encuentra sin marcar: UNA
-- vez por cuenta, garantizado por la base y no por el cliente. El coste asumido:
-- quien recargue con el aviso delante ya no lo vuelve a ver.
-- (Cambia de STABLE a VOLATILE: escribe. CREATE OR REPLACE lo admite.)
CREATE OR REPLACE FUNCTION public.mi_compensacion_tvr()
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.compensacion_tvr_20261015 c
  SET aviso_visto_en = now()
  WHERE c.user_id = auth.uid()
    AND c.aviso_visto_en IS NULL
  RETURNING jsonb_build_object(
    'intento', c.intento_tvr,
    'puntos',  c.puntos_extra,
    'racha',   c.racha_nueva
  );
$$;

-- Se conserva por compatibilidad con la v84 de la app, que la llama al cerrar.
-- Ya no hace falta (la marca la pone la de arriba) y es inofensiva: solo toca
-- filas aún sin marcar de quien llama.
CREATE OR REPLACE FUNCTION public.compensacion_tvr_vista()
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.compensacion_tvr_20261015
  SET aviso_visto_en = now()
  WHERE user_id = auth.uid() AND aviso_visto_en IS NULL;
$$;

-- Una función nueva nace con EXECUTE para PUBLIC: anon no tiene uid y no pinta
-- nada aquí.
REVOKE ALL ON FUNCTION public.mi_compensacion_tvr()     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.compensacion_tvr_vista()  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_compensacion_tvr()    TO authenticated;
GRANT EXECUTE ON FUNCTION public.compensacion_tvr_vista() TO authenticated;
