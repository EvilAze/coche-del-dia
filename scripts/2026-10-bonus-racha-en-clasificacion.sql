-- scripts/2026-10-bonus-racha-en-clasificacion.sql
-- LA CLASIFICACIÓN DEJA DE IGNORAR EL BONUS DE RACHA.
--
-- Aplicar en el SQL editor de Supabase. Idempotente (se puede ejecutar N veces).
-- ANTES: ejecuta scripts/2026-10-bonus-racha-previsualizar.sql (solo lectura)
-- para ver quién sube y quién baja con los datos reales.
--
-- ---------------------------------------------------------------------------
-- QUÉ ESTABA MAL
-- ---------------------------------------------------------------------------
-- Un jugador avisó de que, al acertar a la tercera, sumaba 4 puntos y no 4+3.
-- Su racha y sus puntos estaban bien: lo que se contaba mal era la
-- CLASIFICACIÓN. get_season_leaderboard (y get_monthly_leaderboard) recalculan
-- los puntos desde user_guesses con la tabla base por intento y NADA más. El
-- perfil (stats.total_points, que escribe record_daily_result) sí sumaba el
-- bonus, así que la misma persona tenía dos puntuaciones distintas según dónde
-- se mirase.
--
-- La omisión era deliberada (supabase-monthly-ranking.sql, junio: «el bonus de
-- racha NO entra en el cómputo mensual a propósito»), pero esa decisión nunca
-- llegó a la interfaz: «Cómo se puntúa» —que se abre DESDE la clasificación—
-- dice «El bonus se suma a los puntos base de cada día». La pantalla que
-- promete el bonus era la que no lo aplicaba. Se corrige el cálculo, no el texto.
--
-- ---------------------------------------------------------------------------
-- CÓMO SE CALCULA (y por qué no hace falta migrar datos)
-- ---------------------------------------------------------------------------
-- La clasificación ya se recalcula al vuelo desde user_guesses, así que el
-- bonus también: se reconstruye la racha de cada jugador día a día y se suma lo
-- que habría dado record_daily_result (2º día +1, 3º +2, 4º en adelante +3).
-- Por eso el arreglo es RETROACTIVO sin escribir un solo dato: todas las
-- temporadas y semanas que aún se calculan en vivo salen corregidas.
--
-- Una racha son victorias en la DIARIA en días consecutivos. Una derrota o un
-- día sin jugar la rompe (ahí no hay victoria adyacente). Se calcula con las
-- «islas» de fechas consecutivas: fecha − nº de orden es constante dentro de
-- una racha. Comprobado contra una repetición día a día de la regla vigente
-- sobre 20.000 historiales aleatorios, sin una sola divergencia.
--
-- LA RACHA SE MIDE CON TODO EL HISTORIAL, NO SOLO CON LA TEMPORADA. Quien llega
-- a la semana con 9 días de racha cobra +3 desde el primer día, igual que en su
-- perfil. Si se reiniciase al empezar el periodo, se penalizaría justo a los
-- jugadores más constantes.
--
-- ---------------------------------------------------------------------------
-- QUÉ NO HACE
-- ---------------------------------------------------------------------------
--   · NO reescribe los podios ya sellados (season_podium, monthly_podium): son
--     historia y se quedan como se entregaron. Tampoco los recalcules: llamar
--     a compute_season_podium / compute_monthly_podium / backfill_monthly_podiums
--     sobre un periodo cerrado reasignaría medallas con la regla nueva. Solo se
--     sella con ella lo que cierre a partir de ahora.
--   · NO toca stats ni user_guesses. Es solo lectura sobre ellas.
--   · NO cambia el tie-break ni los filtros (excluidos, shadowban, nick vacío):
--     las funciones se PARCHEAN, no se reescriben (ver más abajo).
--
-- ---------------------------------------------------------------------------
-- POR QUÉ SE PARCHEA EL CUERPO EN VEZ DE PEGAR LAS FUNCIONES ENTERAS
-- ---------------------------------------------------------------------------
-- Mismo motivo y mismo mecanismo que scripts/2026-08-exclusion-de-clasificacion.sql:
-- las copias del repo ya NO son lo que corre en producción (la exclusión se
-- parcheó en vivo, y hay más migraciones encima). Pegarlas con CREATE OR
-- REPLACE se llevaría por delante esos filtros en silencio, en las funciones
-- que deciden quién gana. Se lee la definición REAL con pg_get_functiondef, se
-- hacen tres sustituciones EXACTAS y, si alguna de las tres no encuentra
-- exactamente UNA coincidencia, la función se deja SIN TOCAR y se avisa.

-- ============================================================================
-- [1] El cálculo del bonus, una sola vez
-- ============================================================================
-- Devuelve (jugador, fecha, bonus) para las victorias en la diaria que caen en
-- [p_desde, p_hasta] y llevan bonus > 0. Las dos clasificaciones la usan, así
-- que no pueden divergir entre sí.
--
-- PRIVADA: devuelve qué días jugó cada jugador, que no es un dato público. En
-- Supabase una función nueva nace con EXECUTE para anon y authenticated, así
-- que se revoca explícitamente. Las clasificaciones son SECURITY DEFINER y la
-- llaman con los permisos de su dueño.
--
-- prev_car_ids: las revisiones del cambio de emergencia cuentan como la diaria
-- (igual que en record_daily_result_v2), para no romperle la racha a quien
-- jugó el coche saliente ese día.
CREATE OR REPLACE FUNCTION public.bonus_racha_diaria(p_desde date, p_hasta date)
RETURNS TABLE (user_id uuid, fecha date, bonus int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH diarias AS (
    SELECT DISTINCT ug.user_id, ug.date AS fecha
    FROM public.user_guesses ug
    JOIN public.daily_cars dc ON dc.date = ug.date
     AND (ug.car_id = dc.car_id OR ug.car_id = ANY (COALESCE(dc.prev_car_ids, '{}'::uuid[])))
    WHERE ug.status = 'won'
      AND ug.date <= p_hasta
      -- Solo quien ganó algo en el rango: el resto no puede sumar bonus y
      -- reconstruir su historia entera sería trabajo tirado.
      AND ug.user_id IN (
        SELECT g.user_id FROM public.user_guesses g
        WHERE g.status = 'won' AND g.date BETWEEN p_desde AND p_hasta
      )
  ),
  islas AS (
    SELECT d.user_id, d.fecha,
           d.fecha - (ROW_NUMBER() OVER (PARTITION BY d.user_id ORDER BY d.fecha))::int AS grp
    FROM diarias d
  ),
  racha AS (
    SELECT i.user_id, i.fecha,
           ROW_NUMBER() OVER (PARTITION BY i.user_id, i.grp ORDER BY i.fecha) AS dia_de_racha
    FROM islas i
  )
  SELECT r.user_id, r.fecha,
         (CASE WHEN r.dia_de_racha >= 4 THEN 3
               WHEN r.dia_de_racha  = 3 THEN 2
               WHEN r.dia_de_racha  = 2 THEN 1
               ELSE 0 END)::int AS bonus
  FROM racha r
  WHERE r.fecha BETWEEN p_desde AND p_hasta
    AND r.dia_de_racha >= 2;
$$;

REVOKE ALL ON FUNCTION public.bonus_racha_diaria(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bonus_racha_diaria(date, date) TO service_role;

COMMENT ON FUNCTION public.bonus_racha_diaria(date, date) IS
  'Bonus de racha por jugador y día, reconstruido desde user_guesses. RÉPLICA de la tabla de record_daily_result (2º +1, 3º +2, 4º+ +3). Si cambias la regla allí, cámbiala aquí.';

-- ============================================================================
-- [2] Enseñársela a las dos clasificaciones
-- ============================================================================
-- Tres sustituciones por función, todas sobre líneas sueltas (no dependen de
-- saltos de línea):
--   (a) abrir un CTE `bonus_usuario` justo antes de `agg AS (`,
--   (b) engancharlo con un LEFT JOIN al FROM de `scored`,
--   (c) sumarlo a los puntos.
-- El HAVING (puntos > 0) se queda como está: el bonus solo existe junto a una
-- victoria, y toda victoria ya da puntos base.
--
-- get_my_season_rank, compute_season_podium, snapshot_daily_ranks y
-- compute_monthly_podium leen de estas dos, así que heredan el cambio sin tocarlas.
DO $patch$
DECLARE
  r            record;
  v_pts_viejo  text;
  v_pts_nuevo  text;
  v_from_viejo text;
  v_from_nuevo text;
  v_cte_nuevo  text;
  v_def        text;
  v_parcheadas int := 0;
  v_saltadas   int := 0;

  -- Cuántas veces aparece un texto en la definición. Se exige UNA: cero es que
  -- la función cambió de forma, más de una es que la sustitución sería ambigua.
  v_n int;
BEGIN
  FOR r IN
    SELECT pr.oid, pr.proname, pg_get_functiondef(pr.oid) AS def
    FROM pg_proc pr
    JOIN pg_namespace n ON n.oid = pr.pronamespace
    WHERE n.nspname = 'public'
      -- pg_get_functiondef lanza 42809 sobre agregados y funciones de ventana.
      AND pr.prokind = 'f'
      AND pr.proname IN ('get_season_leaderboard', 'get_monthly_leaderboard')
  LOOP
    v_def := r.def;

    IF position('bonus_racha_diaria' in v_def) > 0 THEN
      RAISE NOTICE '[2] %: ya suma el bonus. Nada que hacer.', r.proname;
      CONTINUE;
    END IF;

    IF r.proname = 'get_season_leaderboard' THEN
      -- Esta versión (semanal) lleva el rango en variables plpgsql.
      IF position('v_starts_at' in v_def) = 0 OR position('v_ends_at' in v_def) = 0 THEN
        v_saltadas := v_saltadas + 1;
        RAISE NOTICE '[2] %: AVISO, no usa v_starts_at/v_ends_at (¿versión anterior a 2026-09-ranking-semanal.sql?). NO se ha tocado.', r.proname;
        CONTINUE;
      END IF;
      v_pts_viejo  := $q$SUM(CASE WHEN s2.is_daily THEN s2.base ELSE CEIL(s2.base/2.0) END)::int AS points,$q$;
      v_pts_nuevo  := $q$(SUM(CASE WHEN s2.is_daily THEN s2.base ELSE CEIL(s2.base/2.0) END) + COALESCE(MAX(bu.bonus), 0))::int AS points,$q$;
      v_from_viejo := $q$FROM scored s2$q$;
      v_from_nuevo := $q$FROM scored s2 LEFT JOIN bonus_usuario bu ON bu.user_id = s2.user_id$q$;
      v_cte_nuevo  := $q$bonus_usuario AS (
    SELECT b.user_id, SUM(b.bonus)::int AS bonus
    FROM public.bonus_racha_diaria(v_starts_at, v_ends_at) b
    GROUP BY b.user_id
  ),
  agg AS ($q$;
    ELSE
      -- get_monthly_leaderboard: el rango sale del CTE `bounds` (stop es EXCLUSIVO).
      IF position('bounds' in v_def) = 0 THEN
        v_saltadas := v_saltadas + 1;
        RAISE NOTICE '[2] %: AVISO, no aparece el CTE bounds. NO se ha tocado.', r.proname;
        CONTINUE;
      END IF;
      v_pts_viejo  := $q$SUM(CASE WHEN s.is_daily THEN s.base ELSE CEIL(s.base / 2.0) END)::int AS points,$q$;
      v_pts_nuevo  := $q$(SUM(CASE WHEN s.is_daily THEN s.base ELSE CEIL(s.base / 2.0) END) + COALESCE(MAX(bu.bonus), 0))::int AS points,$q$;
      v_from_viejo := $q$FROM scored s$q$;
      v_from_nuevo := $q$FROM scored s LEFT JOIN bonus_usuario bu ON bu.user_id = s.user_id$q$;
      v_cte_nuevo  := $q$bonus_usuario AS (
    SELECT b.user_id, SUM(b.bonus)::int AS bonus
    FROM bounds, public.bonus_racha_diaria(bounds.start, (bounds.stop - 1)) b
    GROUP BY b.user_id
  ),
  agg AS ($q$;
    END IF;

    -- Las tres coincidencias, o no se toca nada.
    v_n := (length(v_def) - length(replace(v_def, v_pts_viejo, ''))) / length(v_pts_viejo);
    IF v_n <> 1 THEN
      v_saltadas := v_saltadas + 1;
      RAISE NOTICE '[2] %: AVISO, la línea de puntos aparece % veces (se esperaba 1). NO se ha tocado.', r.proname, v_n;
      CONTINUE;
    END IF;
    v_n := (length(v_def) - length(replace(v_def, v_from_viejo, ''))) / length(v_from_viejo);
    IF v_n <> 1 THEN
      v_saltadas := v_saltadas + 1;
      RAISE NOTICE '[2] %: AVISO, «%» aparece % veces (se esperaba 1). NO se ha tocado.', r.proname, v_from_viejo, v_n;
      CONTINUE;
    END IF;
    v_n := (length(v_def) - length(replace(v_def, 'agg AS (', ''))) / length('agg AS (');
    IF v_n <> 1 THEN
      v_saltadas := v_saltadas + 1;
      RAISE NOTICE '[2] %: AVISO, «agg AS (» aparece % veces (se esperaba 1). NO se ha tocado.', r.proname, v_n;
      CONTINUE;
    END IF;

    v_def := replace(v_def, v_pts_viejo,  v_pts_nuevo);
    v_def := replace(v_def, v_from_viejo, v_from_nuevo);
    v_def := replace(v_def, 'agg AS (',   v_cte_nuevo);

    -- CREATE OR REPLACE conserva dueño y permisos: los GRANT a anon/authenticated
    -- siguen como estaban. Si el texto resultante no compila, falla aquí y la
    -- función original sigue intacta (la transacción del bloque se deshace).
    EXECUTE v_def;
    v_parcheadas := v_parcheadas + 1;
    RAISE NOTICE '[2] %: parcheada.', r.proname;
  END LOOP;

  IF v_parcheadas = 0 AND v_saltadas = 0 THEN
    RAISE NOTICE '[2] Nada que parchear (o ya estaba todo hecho).';
  END IF;
  IF v_saltadas > 0 THEN
    RAISE NOTICE '[2] PENDIENTE: % funcion(es) sin parchear. La clasificación NO es coherente hasta arreglarlas.', v_saltadas;
  END IF;
END
$patch$;

-- ============================================================================
-- [3] Verificación
-- ============================================================================
-- Las dos funciones deben salir con `suma_bonus = true`. Una sola consulta,
-- porque el editor solo enseña el resultado de la última sentencia.
SELECT pr.proname,
       position('bonus_racha_diaria' in pg_get_functiondef(pr.oid)) > 0 AS suma_bonus,
       -- Lo que ya había (la exclusión de clasificación) debe seguir ahí.
       position('excluidos_de_clasificacion' in pg_get_functiondef(pr.oid)) > 0 AS sigue_excluyendo
FROM pg_proc pr
JOIN pg_namespace n ON n.oid = pr.pronamespace
WHERE n.nspname = 'public'
  AND pr.prokind = 'f'
  AND pr.proname IN ('get_season_leaderboard', 'get_monthly_leaderboard')
ORDER BY pr.proname;

-- ============================================================================
-- [4] OPCIONAL — que las flechas de subida/bajada no mientan hoy
-- ============================================================================
-- «Subes 3 puestos» compara tu puesto actual con la foto que sacó el cron a
-- medianoche, y esa foto se hizo con la regla vieja: hoy, a quien tiene racha,
-- le saldrían subidas que no ha ganado jugando. snapshot_daily_ranks() es
-- idempotente (borra y reinserta el día), así que re-sellarla justo después de
-- aplicar este script deja las flechas en neutro hasta mañana. Coste: hoy no se
-- verá el movimiento real de las partidas ya jugadas. Descomenta para hacerlo.
--
--   SELECT public.snapshot_daily_ranks();
