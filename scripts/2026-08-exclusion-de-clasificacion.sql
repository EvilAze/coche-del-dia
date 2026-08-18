-- scripts/2026-08-exclusion-de-clasificacion.sql
-- LA AUDITORÍA DEJA DE SER UN ESPEJO Y PASA A TENER PALANCA.
--
-- Aplicar en el SQL editor de Supabase. Idempotente (se puede ejecutar N veces).
--
-- ---------------------------------------------------------------------------
-- QUÉ FALTABA
-- ---------------------------------------------------------------------------
-- El panel de Auditoría detecta el patrón del oráculo —la misma IP sondea el
-- coche del día bajo una identidad y luego lo gana al primer intento con otra—
-- y lo presenta con su z-score, su tiempo hasta la victoria y su score. Es un
-- trabajo fino. Y termina ahí: el panel es de solo lectura, no hay ninguna
-- columna `banned` ni `excluded` en todo el esquema, y la única herramienta
-- para actuar era abrir el SQL editor.
--
-- O sea: si el señalado está en el podio de la temporada, el podio se congela
-- con él dentro, porque `compute_season_podium` corre solo desde `warm-daily`
-- a medianoche y no espera a que nadie decida nada.
--
-- ---------------------------------------------------------------------------
-- TABLA APARTE Y NO UNA COLUMNA EN `profiles`
-- ---------------------------------------------------------------------------
-- `profiles` tiene SELECT público (lo necesita la clasificación). Una columna
-- `excluido` ahí sería legible por cualquiera con la anon key, así que
-- cualquiera podría enumerar a quién hemos excluido: publicar el registro de
-- moderación entero. Y quitarle el grant a una sola columna obliga a revocar el
-- SELECT de la tabla y re-concederlo columna a columna, que es justo el tipo de
-- cambio que rompe una lectura que nadie recordaba.
--
-- Tabla propia, deny-all, mismo patrón que `nicks_retirados` y
-- `push_subscriptions`. Las funciones de clasificación son SECURITY DEFINER, así
-- que la leen sin problema aunque el cliente no pueda ni verla.
--
-- ---------------------------------------------------------------------------
-- QUÉ SIGNIFICA «EXCLUIR», EXACTAMENTE
-- ---------------------------------------------------------------------------
-- Desaparecer de las tablas públicas. NO se le borra la cuenta, NO se le tocan
-- los puntos, NO se le quita la racha y NO se le impide jugar: sigue jugando,
-- sigue sumando y sigue viendo su Archivo y sus estadísticas. Lo único que pasa
-- es que no sale en la clasificación de temporada, ni en la histórica, ni en el
-- salón de campeones, ni entra en los podios que se sellen a partir de ahora.
--
-- Es deliberadamente lo MENOS ruidoso que resuelve el problema. Un baneo
-- anunciado invita a discutir y, sobre todo, a abrirse otra cuenta —que contra
-- un juego con login de Google cuesta treinta segundos—, así que lo que se gana
-- es que el podio deje de estar ocupado, no una victoria moral.
--
-- Su propio puesto también se queda en NULL (`get_my_season_rank` se calcula
-- desde el mismo leaderboard), así que la píldora de la cabecera se le queda
-- vacía. Es detectable si se fija. Se asume: la alternativa era mantener dos
-- verdades distintas del ranking y ese es el camino a que no cuadre ninguna.

-- ============================================================================
-- [1] La lista
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.excluidos_de_clasificacion (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  motivo     text,
  excluido_en timestamptz NOT NULL DEFAULT now(),
  -- Email del admin que lo decidió. Una acción de moderación sin autor es una
  -- acción que nadie puede revisar seis meses después.
  por         text
);

COMMENT ON TABLE public.excluidos_de_clasificacion IS
  'Cuentas fuera de las tablas públicas (siguen jugando). Deny-all: solo service_role.';

ALTER TABLE public.excluidos_de_clasificacion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.excluidos_de_clasificacion FROM anon, authenticated;

-- ============================================================================
-- [2] Enseñarle la lista a las tres funciones que producen tablas públicas
-- ============================================================================
-- Todo el sistema de clasificación pasa por TRES embudos, y todo lo demás se
-- deriva de ellos:
--
--   get_season_leaderboard  → de aquí leen get_my_season_rank y
--                             compute_season_podium (o sea, también el podio).
--   get_monthly_leaderboard → de aquí leen get_my_monthly_rank y
--                             compute_monthly_podium. OJO: el ranking mensual
--                             es ANTERIOR a las temporadas y la app ya no lo
--                             llama desde ninguna pantalla (solo queda nombrado
--                             en comentarios de lib/admin-handlers/analytics.js).
--                             Se parchea igual, porque las funciones siguen ahí
--                             y con GRANT a anon: una función pública que
--                             ignorase la exclusión sería una puerta abierta
--                             aunque hoy no la use nuestro cliente.
--   get_champions           → el salón, que lee season_podium ya sellado; como
--                             filtra en LECTURA, excluir a alguien lo retira
--                             también de los podios viejos.
--
-- FALTA UNA CUARTA TABLA Y NO ESTÁ AQUÍ: «Leyendas», el histórico acumulado.
-- No es una función —el cliente consultaba `stats` directamente—, así que no
-- había cuerpo que parchear. Se convierte en RPC en
-- scripts/2026-08-leyendas-por-rpc.sql, que hay que aplicar DESPUÉS de este.
-- Sin ese fichero la exclusión está a medias, y a medias justo en la tabla de
-- la que más cuesta salir, porque es la única que no se resetea por temporada.
--
-- Los tres tienen escrita LA MISMA línea, palabra por palabra:
--
--   WHERE p.display_name IS NOT NULL AND p.display_name <> ''
--
-- ---------------------------------------------------------------------------
-- POR QUÉ SE PARCHEA EL CUERPO EN VEZ DE PEGAR LAS TRES FUNCIONES ENTERAS
-- ---------------------------------------------------------------------------
-- Lo natural sería copiar las definiciones de scripts/2026-07-temporadas.sql,
-- supabase-monthly-ranking.sql y 2026-07-salon-campeones.sql, añadirles la
-- condición y pegarlas aquí con CREATE OR REPLACE. El problema es que eso
-- sobrescribe producción con lo que dice el REPOSITORIO, y este repositorio ya
-- se ha desviado de producción antes — hay un commit que se llama literalmente
-- «cuadrar el SQL de T4 con lo que hay en producción». Si alguien tocó una de
-- estas funciones desde el SQL editor y no lo trajo al repo, pegarla entera se
-- lo lleva por delante en silencio, y encima en las funciones que deciden quién
-- gana.
--
-- Así que se lee la definición REAL con pg_get_functiondef, se le sustituye esa
-- única línea y se vuelve a ejecutar. Lo que haya en producción se conserva tal
-- cual salvo el predicado nuevo. CREATE OR REPLACE mantiene dueño y permisos,
-- así que los GRANT a anon/authenticated siguen intactos.
--
-- Y si el filtro esperado NO aparece en alguna (porque se reescribió con otro
-- formato), esa función se deja SIN TOCAR y se avisa por NOTICE. Fallar
-- haciendo nada y diciéndolo es lo correcto aquí: lo contrario es adivinar
-- dentro de la función que reparte las medallas.
DO $patch$
DECLARE
  -- Dollar-quoting anidado para no tener que doblar las comillas del `<> ''`,
  -- que es donde se equivoca uno al escribir esto a mano.
  v_viejo constant text :=
    $q$p.display_name IS NOT NULL AND p.display_name <> ''$q$;
  v_nuevo constant text :=
    $q$p.display_name IS NOT NULL AND p.display_name <> '' AND NOT EXISTS (SELECT 1 FROM public.excluidos_de_clasificacion ex WHERE ex.user_id = p.id)$q$;
  r          record;
  v_parcheadas int := 0;
  v_saltadas   int := 0;
BEGIN
  FOR r IN
    SELECT pr.oid, pr.proname, pg_get_functiondef(pr.oid) AS def
    FROM pg_proc pr
    JOIN pg_namespace n ON n.oid = pr.pronamespace
    WHERE n.nspname = 'public'
      AND pr.proname IN (
        'get_season_leaderboard',
        'get_monthly_leaderboard',
        'get_champions'
      )
  LOOP
    IF position(v_nuevo in r.def) > 0 THEN
      RAISE NOTICE '[2] %: ya excluye. Nada que hacer.', r.proname;
      CONTINUE;
    END IF;

    IF position(v_viejo in r.def) = 0 THEN
      v_saltadas := v_saltadas + 1;
      RAISE NOTICE '[2] %: AVISO, no aparece el filtro esperado. NO se ha tocado.', r.proname;
      RAISE NOTICE '[2]   Revisa su cuerpo a mano y anadele: AND NOT EXISTS (SELECT 1 FROM public.excluidos_de_clasificacion ex WHERE ex.user_id = p.id)';
      CONTINUE;
    END IF;

    -- `replace` sustituye TODAS las apariciones. En las tres funciones la línea
    -- aparece una sola vez; si algún día apareciera dos, las dos querrían el
    -- mismo predicado, así que sustituir todas sigue siendo lo correcto.
    EXECUTE replace(r.def, v_viejo, v_nuevo);
    v_parcheadas := v_parcheadas + 1;
    RAISE NOTICE '[2] %: parcheada.', r.proname;
  END LOOP;

  IF v_parcheadas = 0 AND v_saltadas = 0 THEN
    RAISE NOTICE '[2] Nada que parchear (o ya estaba todo hecho).';
  END IF;
  IF v_saltadas > 0 THEN
    RAISE NOTICE '[2] PENDIENTE: % funcion(es) sin parchear. La exclusion NO es completa hasta arreglarlas.', v_saltadas;
  END IF;
END
$patch$;

-- ============================================================================
-- [3] Verificación
-- ============================================================================
-- Una sola consulta, por lo mismo que en el script del nick: el editor solo
-- enseña el resultado de la última sentencia.
--
-- Lectura esperada: las tres funciones en «excluye», y el recuento de excluidos
-- en 0 mientras no se use el botón.
SELECT comprobacion, estado FROM (
  SELECT 1 AS orden, 'Tabla excluidos_de_clasificacion' AS comprobacion,
    coalesce(
      (SELECT 'creada' FROM pg_class
       WHERE relname = 'excluidos_de_clasificacion' AND relkind = 'r'),
      'FALTA') AS estado

  UNION ALL SELECT 2, 'get_season_leaderboard',
    coalesce((SELECT CASE WHEN pg_get_functiondef(pr.oid) LIKE '%excluidos_de_clasificacion%'
                     THEN 'excluye' ELSE 'SIN PARCHEAR' END
              FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
              WHERE n.nspname='public' AND pr.proname='get_season_leaderboard' LIMIT 1),
             'no existe')

  UNION ALL SELECT 3, 'get_monthly_leaderboard',
    coalesce((SELECT CASE WHEN pg_get_functiondef(pr.oid) LIKE '%excluidos_de_clasificacion%'
                     THEN 'excluye' ELSE 'SIN PARCHEAR' END
              FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
              WHERE n.nspname='public' AND pr.proname='get_monthly_leaderboard' LIMIT 1),
             'no existe')

  UNION ALL SELECT 4, 'get_champions',
    coalesce((SELECT CASE WHEN pg_get_functiondef(pr.oid) LIKE '%excluidos_de_clasificacion%'
                     THEN 'excluye' ELSE 'SIN PARCHEAR' END
              FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
              WHERE n.nspname='public' AND pr.proname='get_champions' LIMIT 1),
             'no existe')

  UNION ALL SELECT 5, 'Cuentas excluidas ahora mismo',
    (SELECT count(*)::text FROM public.excluidos_de_clasificacion)
) v
ORDER BY orden;
