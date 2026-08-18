-- scripts/2026-08-leyendas-por-rpc.sql
-- «LEYENDAS» PASA POR UNA RPC, COMO LAS OTRAS TRES TABLAS.
--
-- Aplicar en el SQL editor de Supabase. Idempotente y SIN ORDEN OBLIGATORIO
-- respecto a los otros scripts de agosto: filtra por `profiles.is_flagged`, que
-- existe desde junio de 2026, así que no depende de ninguna migración reciente.
--
-- OJO SI LEES UNA VERSIÓN VIEJA DE ESTE FICHERO EN EL HISTORIAL: nació filtrando
-- por una tabla `excluidos_de_clasificacion` que duró unas horas. Resultó que el
-- proyecto YA tenía un shadowban —`is_flagged`, escondido dentro del cuerpo de
-- dos policies de RLS y en ningún otro sitio— y se unificaron los dos en
-- 2026-08-unificar-shadowban.sql, que borró aquella tabla. Este fichero quedó
-- apuntando a algo inexistente: como Postgres valida el cuerpo de una función
-- SQL al crearla, ejecutarlo daba error en vez de crear nada.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ
-- ---------------------------------------------------------------------------
-- La exclusión de clasificación se montó parcheando las tres funciones que
-- producen tablas públicas. Faltaba una tabla, y precisamente la más visible
-- del histórico: **Leyendas no es una función**. `getLeaderboard()` en
-- src/lib/statsService.js consulta `stats` DIRECTAMENTE desde el navegador,
-- con el join a `profiles` y dos filtros —`total_points > 0` en el servidor y
-- «tiene display_name» ya en JavaScript, sobre las filas recibidas—.
--
-- Consecuencia: una cuenta excluida seguía saliendo en Leyendas, que es
-- justamente la tabla de la que cuesta más salir (es acumulativa: no se
-- resetea cada temporada). La exclusión estaba a medias y no se notaba, porque
-- la pestaña que la delata es la que hay que abrir a mano.
--
-- De paso arregla dos cosas que venían de que la consulta viviera en el
-- cliente:
--
--   · El filtro de `display_name` se aplicaba DESPUÉS de recibir los datos, así
--     que las filas de quien no tiene nick viajaban igualmente al navegador y
--     se descartaban al pintar. Ahora no salen de la base de datos.
--   · El orden era `total_points DESC, max_streak DESC` sin tercer criterio,
--     así que dos cuentas empatadas en ambos podían intercambiarse de puesto
--     entre dos aperturas sin que cambiara nada. Se añade `user_id` como
--     desempate estable, igual que hace get_season_leaderboard.
--
-- NO se revoca el SELECT público de `stats`: lo siguen leyendo el perfil propio
-- y otras pantallas, y cerrarlo es una decisión aparte con su propio riesgo de
-- romper una lectura que nadie recuerda. Esto solo mueve la TABLA PÚBLICA a una
-- función, que es donde se puede filtrar de verdad.

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
  -- El puesto lo sigue numerando el cliente por el orden de llegada (índice del
  -- map), igual que antes: así la regla de «racha viva» (isStreakAlive, que
  -- necesita la hora del navegador) se queda donde estaba y esta función no
  -- tiene que saber nada de husos horarios.
  ORDER BY s.total_points DESC, s.max_streak DESC, s.user_id
  LIMIT GREATEST(1, COALESCE(p_limit, 1000));
$$;

REVOKE ALL ON FUNCTION public.get_legends_leaderboard(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_legends_leaderboard(int) TO anon, authenticated;

-- ============================================================================
-- Verificación
-- ============================================================================
-- Cuántos salen en Leyendas y cuántos quedan fuera por estar marcados. El
-- segundo número es 0 mientras no se use el botón del panel; si algún día no lo
-- es, la diferencia entre la primera y la tercera columna es exactamente ese
-- segundo número, y eso dice que el shadowban está haciendo su trabajo.
SELECT
  (SELECT count(*) FROM public.get_legends_leaderboard(1000000))     AS en_leyendas,
  (SELECT count(*) FROM public.profiles WHERE is_flagged IS TRUE)    AS marcados,
  (SELECT count(*) FROM public.stats s
     JOIN public.profiles p ON p.id = s.user_id
    WHERE s.total_points > 0
      AND p.display_name IS NOT NULL AND p.display_name <> '')       AS elegibles_sin_filtrar;
