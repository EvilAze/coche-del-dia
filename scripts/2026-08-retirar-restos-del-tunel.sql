-- scripts/2026-08-retirar-restos-del-tunel.sql
-- SE VAN LAS TABLAS Y COLUMNAS DEL «TÚNEL DE VIENTO», UN MODO QUE YA NO EXISTE.
--
-- Aplicar en el SQL editor de Supabase. Idempotente (IF EXISTS).
--
-- ---------------------------------------------------------------------------
-- QUÉ ES ESTO
-- ---------------------------------------------------------------------------
-- El «Túnel de viento» fue un modo libre de rejugado: re-adivinar cromos que ya
-- tenías, desenfocados en vez de ampliados, sin límite diario, sin puntos y sin
-- racha. Se creó en julio de 2026 (scripts/2026-07-tunel-modo-libre.sql) y se
-- retiró el 13 del mismo mes en el commit b2c8e39, que borró api/tunel/,
-- api/_lib/tunel/ y src/Tunel.jsx.
--
-- Lo que NO borró ese commit es la base de datos, porque el código y el esquema
-- se despliegan por caminos distintos: el primero lo tumba un `git push`, el
-- segundo solo se mueve cuando alguien pega un fichero en el SQL editor. Así que
-- desde julio hay dos tablas y dos columnas en producción que no lee ni escribe
-- nadie.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ BORRARLO Y NO DEJARLO AHÍ
-- ---------------------------------------------------------------------------
-- No es una cuestión de espacio: son cuatro filas de nada. Es que un esquema
-- miente cuando conserva cosas que ya no significan nada. `stats.tunel_won`
-- invita a leerse como un contador vivo, y dentro de un año nadie recordará que
-- pertenece a un modo que estuvo dos semanas encendido. La misma razón por la
-- que se retiró el sistema de logros del perfil: dos superficies para un
-- trabajo, y aquí ni siquiera hay trabajo.
--
-- Comprobado antes de escribir esto: `grep -rn "tunel" src/ api/ lib/` no
-- devuelve NADA, y ninguna función versionada nombra estas columnas. Las
-- lecturas de `stats` del proyecto son todas con lista explícita de columnas
-- (no hay un solo `select *`), así que quitarlas no puede romper una consulta
-- por sorpresa.
--
-- SE PIERDEN LOS CONTADORES HISTÓRICOS de quien jugó al Túnel aquellas dos
-- semanas. Es aceptable y deliberado: son las estadísticas de un modo que ya no
-- se puede jugar y que no se va a reabrir. El bloque [1] los cuenta y los
-- imprime ANTES de borrarlos, para que quede el número en el log de la consola
-- por si alguna vez alguien pregunta.

-- ============================================================================
-- [1] Qué se va a tirar, dicho en voz alta antes de tirarlo
-- ============================================================================
DO $$
DECLARE
  v_games int := 0;
  v_wins  int := 0;
  v_stats int := 0;
BEGIN
  IF to_regclass('public.tunel_games') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.tunel_games' INTO v_games;
  END IF;
  IF to_regclass('public.tunel_wins') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.tunel_wins' INTO v_wins;
  END IF;

  -- Cuántas cuentas llegaron a jugar alguna partida del modo. Se consulta con
  -- EXECUTE porque si la columna ya no existe (script re-ejecutado) una
  -- referencia directa ni siquiera compilaría el bloque.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stats'
      AND column_name = 'tunel_played'
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.stats WHERE tunel_played > 0' INTO v_stats;
  END IF;

  RAISE NOTICE '[1] tunel_games: % fila(s)', v_games;
  RAISE NOTICE '[1] tunel_wins:  % fila(s)', v_wins;
  RAISE NOTICE '[1] cuentas con alguna partida de Tunel: %', v_stats;
END $$;

-- ============================================================================
-- [2] Las tablas
-- ============================================================================
-- Sin CASCADE a propósito. Si algo dependiera de estas tablas —una vista, una
-- clave foránea que no esperábamos— quiero que el script FALLE y me lo diga, no
-- que se lleve por delante lo que sea que hubiera colgado. Ambas eran deny-all y
-- solo las tocaba el service_role, así que no debería depender nada.
DROP TABLE IF EXISTS public.tunel_wins;
DROP TABLE IF EXISTS public.tunel_games;

-- ============================================================================
-- [3] Las columnas de `stats`
-- ============================================================================
-- `stats` sí es una tabla viva y muy leída, pero estas dos columnas no las toca
-- nadie: todas las lecturas del proyecto piden columnas por nombre.
ALTER TABLE public.stats DROP COLUMN IF EXISTS tunel_played;
ALTER TABLE public.stats DROP COLUMN IF EXISTS tunel_won;

-- ============================================================================
-- [4] Verificación
-- ============================================================================
-- Esperado: las cuatro filas en «fuera».
SELECT comprobacion, estado FROM (
  SELECT 1 AS orden, 'Tabla tunel_games' AS comprobacion,
    coalesce((SELECT 'SIGUE AHI' FROM pg_class
              WHERE relname = 'tunel_games' AND relkind = 'r'), 'fuera') AS estado

  UNION ALL SELECT 2, 'Tabla tunel_wins',
    coalesce((SELECT 'SIGUE AHI' FROM pg_class
              WHERE relname = 'tunel_wins' AND relkind = 'r'), 'fuera')

  UNION ALL SELECT 3, 'Columna stats.tunel_played',
    coalesce((SELECT 'SIGUE AHI' FROM information_schema.columns
              WHERE table_schema='public' AND table_name='stats'
                AND column_name='tunel_played'), 'fuera')

  UNION ALL SELECT 4, 'Columna stats.tunel_won',
    coalesce((SELECT 'SIGUE AHI' FROM information_schema.columns
              WHERE table_schema='public' AND table_name='stats'
                AND column_name='tunel_won'), 'fuera')
) v
ORDER BY orden;
