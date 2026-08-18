-- scripts/2026-08-unificar-shadowban.sql
-- UN SOLO INTERRUPTOR DE SHADOWBAN: `profiles.is_flagged`.
--
-- Aplicar en el SQL editor de Supabase DESPUÉS de
-- 2026-08-exclusion-de-clasificacion.sql y 2026-08-leyendas-por-rpc.sql.
-- Idempotente.
--
-- ---------------------------------------------------------------------------
-- QUÉ PASÓ
-- ---------------------------------------------------------------------------
-- `2026-08-exclusion-de-clasificacion.sql` creó `excluidos_de_clasificacion`
-- para darle palanca al panel de Auditoría. Estaba construyendo un SEGUNDO
-- mecanismo de shadowban sin saberlo: ya existía `profiles.is_flagged`, con dos
-- policies colgando de él desde junio de 2026
-- (scripts/2026-06-rls-performance-lints.sql):
--
--   profiles_select  USING (id = auth.uid() OR NOT is_flagged)
--   stats_select     USING (user_id = auth.uid()
--                           OR NOT EXISTS (... p.is_flagged = true))
--
-- No se veía porque `is_flagged` no aparece en NINGÚN otro sitio del proyecto:
-- ni una migración que lo declare, ni una línea de código que lo lea o lo
-- escriba. Existe solo dentro del cuerpo de esas dos policies, y se pone a mano
-- desde el SQL editor. Es exactamente el tipo de cosa que un `grep` encuentra y
-- una lectura apresurada del `grep` no.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ HAY QUE UNIFICAR, Y NO DEJAR LOS DOS
-- ---------------------------------------------------------------------------
-- Dos interruptores para el mismo trabajo significa que la pregunta «¿está esta
-- cuenta vetada?» tiene dos respuestas que pueden no coincidir. Y peor: cada
-- uno protege un camino distinto y NINGUNO protege los dos.
--
--   · `is_flagged` vive en RLS, así que solo actúa sobre las consultas DIRECTAS
--     del cliente. Cualquier función SECURITY DEFINER se lo salta — y eso
--     incluye get_season_leaderboard y get_champions, donde una cuenta marcada
--     seguía saliendo tan tranquila.
--   · `excluidos_de_clasificacion` era al revés: lo miraban las funciones y no
--     lo miraba RLS.
--
-- La lección de verdad es la de la dirección del proyecto: cada migración mueve
-- otra lectura del cliente a una RPC (temporadas, campeones, perfil público y
-- ahora Leyendas), y cada una de esas mudanzas apagaba un poco más el
-- `is_flagged` que ya había, en silencio y sin que nada fallara. La que faltaba
-- era Leyendas, la última lectura directa que quedaba: al convertirla en RPC,
-- `is_flagged` se habría quedado sin ningún sitio donde surtir efecto.
--
-- Se gana `is_flagged` porque ya existe, ya tiene datos reales y ya está
-- cableado en dos policies. La tabla nueva se va: nació hace veinte minutos y
-- está vacía. El flag pasa a tener DOS puntos de aplicación —RLS para las
-- lecturas directas, y un predicado explícito en cada función que produce una
-- tabla pública— porque ese es justo el agujero que lo tenía a medias.

-- ============================================================================
-- [1] Las tres funciones parcheadas vuelven a parchearse, ahora contra el flag
-- ============================================================================
-- Mismo método que en la migración anterior y por el mismo motivo (ver allí):
-- se lee la definición REAL y se sustituye el predicado, en vez de pegar el
-- cuerpo entero desde el repositorio. Aquí además la cadena a sustituir la
-- escribió el script anterior, así que se sabe exacta.
--
-- `IS NOT TRUE` y no `= false`: si `is_flagged` fuera NULL en alguna fila,
-- `NOT is_flagged` da NULL y la fila desaparecería de la clasificación sin que
-- nadie la haya marcado. Es el mismo criterio —y la misma trampa— que documenta
-- 2026-07-rls-anonimos-fuera-de-la-tabla.sql para el claim `is_anonymous`.
DO $patch$
DECLARE
  v_viejo constant text :=
    $q$ AND NOT EXISTS (SELECT 1 FROM public.excluidos_de_clasificacion ex WHERE ex.user_id = p.id)$q$;
  v_nuevo constant text :=
    $q$ AND p.is_flagged IS NOT TRUE$q$;
  r record;
  v_hechas int := 0;
BEGIN
  FOR r IN
    SELECT pr.oid, pr.proname, pg_get_functiondef(pr.oid) AS def
    FROM pg_proc pr
    JOIN pg_namespace n ON n.oid = pr.pronamespace
    WHERE n.nspname = 'public'
      -- Funciones normales y nada más. Los agregados y las funciones de ventana
      -- hacen que pg_get_functiondef lance 42809 (ver el comentario largo de
      -- [3]); aquí el filtro por nombre ya lo hacía improbable, pero lo que se
      -- parchea es el cuerpo de una función, así que se dice explícitamente.
      AND pr.prokind = 'f'
      AND pr.proname IN (
        'get_season_leaderboard',
        'get_monthly_leaderboard',
        'get_champions'
      )
  LOOP
    IF position(v_viejo in r.def) = 0 THEN
      RAISE NOTICE '[1] %: sin el predicado viejo (ya migrada, o nunca se parcheo).', r.proname;
      CONTINUE;
    END IF;
    EXECUTE replace(r.def, v_viejo, v_nuevo);
    v_hechas := v_hechas + 1;
    RAISE NOTICE '[1] %: ahora mira is_flagged.', r.proname;
  END LOOP;

  RAISE NOTICE '[1] Funciones migradas: %.', v_hechas;
END
$patch$;

-- ============================================================================
-- [2] Leyendas: se reescribe entera, que es suya y nació ayer
-- ============================================================================
-- Aquí NO hace falta el parcheo quirúrgico: esta función la creó
-- 2026-08-leyendas-por-rpc.sql hace un rato, así que no hay ninguna versión de
-- producción que respetar. Se pega el cuerpo bueno y punto.
--
-- Y esta es la que más importa de las cuatro: era una lectura directa, o sea la
-- única que `is_flagged` protegía de verdad. Sin este bloque, convertirla en RPC
-- habría devuelto a la clasificación a TODA cuenta marcada, en silencio.
CREATE OR REPLACE FUNCTION public.get_legends_leaderboard(p_limit int DEFAULT 1000)
RETURNS TABLE (
  user_id          uuid,
  display_name     text,
  current_streak   int,
  max_streak       int,
  total_wins       int,
  total_points     int,
  last_played_date date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    s.user_id,
    p.display_name,
    COALESCE(s.current_streak, 0)::int,
    COALESCE(s.max_streak, 0)::int,
    COALESCE(s.total_wins, 0)::int,
    COALESCE(s.total_points, 0)::int,
    s.last_played_date
  FROM public.stats s
  JOIN public.profiles p ON p.id = s.user_id
  WHERE s.total_points > 0
    AND p.display_name IS NOT NULL AND p.display_name <> ''
    AND p.is_flagged IS NOT TRUE
  ORDER BY s.total_points DESC, s.max_streak DESC, s.user_id
  LIMIT GREATEST(1, COALESCE(p_limit, 1000));
$$;

REVOKE ALL ON FUNCTION public.get_legends_leaderboard(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_legends_leaderboard(int) TO anon, authenticated;

-- ============================================================================
-- [3] Fuera la tabla que sobra
-- ============================================================================
-- Solo si ya nadie la mira. El guard no es paranoia de más: si [1] hubiera
-- dejado alguna función sin migrar, borrar la tabla la rompería —y sería la
-- función que decide quién sale en la clasificación—.
DO $limpieza$
DECLARE
  v_referencias int;
BEGIN
  -- `prokind NOT IN ('a','w')` NO es adorno: pg_get_functiondef LANZA un error
  -- —«"array_agg" is an aggregate function», 42809— si se le pasa un agregado o
  -- una función de ventana, y en el esquema `public` de este proyecto hay
  -- agregados. Sin este filtro, el recorrido revienta al toparse con uno; y como
  -- el SQL editor ejecuta el fichero entero en UNA transacción, ese error tira
  -- atrás también los bloques [1] y [2], que ya habían hecho su trabajo.
  --
  -- Se excluyen solo esas dos clases porque son exactamente las que fallan: las
  -- funciones normales ('f') y los procedimientos ('p') se introspeccionan sin
  -- problema, y dejarlos dentro mantiene el guard haciendo su trabajo —que es
  -- detectar una referencia en CUALQUIER función, incluida una que se me haya
  -- pasado, no solo en las cuatro que conozco—.
  SELECT count(*) INTO v_referencias
  FROM pg_proc pr
  JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public'
    AND pr.prokind NOT IN ('a', 'w')
    AND pg_get_functiondef(pr.oid) LIKE '%excluidos_de_clasificacion%';

  IF v_referencias > 0 THEN
    RAISE NOTICE '[3] NO se borra la tabla: % funcion(es) siguen nombrandola.', v_referencias;
    RAISE NOTICE '[3] Revisa los NOTICE de [1] y vuelve a ejecutar este fichero.';
  ELSE
    DROP TABLE IF EXISTS public.excluidos_de_clasificacion;
    RAISE NOTICE '[3] Tabla excluidos_de_clasificacion eliminada.';
  END IF;
END
$limpieza$;

-- ============================================================================
-- [4] Verificación
-- ============================================================================
-- Lectura esperada: las cuatro funciones en «mira is_flagged», la tabla
-- sobrante «eliminada», y el recuento de marcados igual al que tú esperes.
SELECT comprobacion, estado FROM (
  SELECT 1 AS orden, 'get_season_leaderboard' AS comprobacion,
    coalesce((SELECT CASE WHEN pg_get_functiondef(pr.oid) LIKE '%is_flagged%'
                     THEN 'mira is_flagged' ELSE 'SIN MIGRAR' END
              FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
              WHERE n.nspname='public' AND pr.proname='get_season_leaderboard' LIMIT 1),
             'no existe') AS estado

  UNION ALL SELECT 2, 'get_monthly_leaderboard',
    coalesce((SELECT CASE WHEN pg_get_functiondef(pr.oid) LIKE '%is_flagged%'
                     THEN 'mira is_flagged' ELSE 'SIN MIGRAR' END
              FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
              WHERE n.nspname='public' AND pr.proname='get_monthly_leaderboard' LIMIT 1),
             'no existe')

  UNION ALL SELECT 3, 'get_champions',
    coalesce((SELECT CASE WHEN pg_get_functiondef(pr.oid) LIKE '%is_flagged%'
                     THEN 'mira is_flagged' ELSE 'SIN MIGRAR' END
              FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
              WHERE n.nspname='public' AND pr.proname='get_champions' LIMIT 1),
             'no existe')

  UNION ALL SELECT 4, 'get_legends_leaderboard',
    coalesce((SELECT CASE WHEN pg_get_functiondef(pr.oid) LIKE '%is_flagged%'
                     THEN 'mira is_flagged' ELSE 'SIN MIGRAR' END
              FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
              WHERE n.nspname='public' AND pr.proname='get_legends_leaderboard' LIMIT 1),
             'no existe')

  UNION ALL SELECT 5, 'Tabla excluidos_de_clasificacion',
    coalesce((SELECT 'SIGUE AHI' FROM pg_class
              WHERE relname='excluidos_de_clasificacion' AND relkind='r'),
             'eliminada')

  UNION ALL SELECT 6, 'Cuentas marcadas (is_flagged)',
    (SELECT count(*)::text FROM public.profiles WHERE is_flagged IS TRUE)

  UNION ALL SELECT 7, 'Jugadores visibles en Leyendas',
    (SELECT count(*)::text FROM public.get_legends_leaderboard(1000000))
) v
ORDER BY orden;
