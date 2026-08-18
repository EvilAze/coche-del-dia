-- scripts/2026-08-estado-operativo.sql
-- LOS TRES PRECIPICIOS DEL JUEGO, CONVERTIDOS EN NÚMEROS.
--
-- Aplicar en el SQL editor de Supabase. Idempotente.
--
-- ---------------------------------------------------------------------------
-- QUÉ PROBLEMA RESUELVE
-- ---------------------------------------------------------------------------
-- Hay tres formas conocidas de que el juego se rompa solo, las tres lentas, y
-- ninguna tenía un número delante:
--
--   1. SE ACABA EL CATÁLOGO. El paso 4 de pick_daily_car repite un coche al
--      azar cuando no quedan sin estrenar, en silencio y sin avisar a nadie.
--      Nunca hubo un contador de cuántos quedan: el análisis de agosto tuvo que
--      calcularlo a mano («162 coches = 5,4 meses»).
--
--   2. SE ACABA LA TEMPORADA Y NO HAY SIGUIENTE. Un hueco deja current_season()
--      en NULL, y con eso la clasificación aparece vacía y sin banner. Las
--      conclusiones de aquel análisis lo dejan escrito: «siempre hay temporada
--      siguiente… ha estado a punto de pasar dos veces». Lo sostenía la memoria
--      de una persona.
--
--   3. UN DÍA PROGRAMADO CON UN COCHE SIN FOTO. Ya pasó: la temporada de Le Mans
--      se estiró hasta programar tres días con `image_ready = false`, o sea tres
--      jornadas de /api/daily-image devolviendo 500 para todo el mundo.
--
-- Los tres se ven en una consulta. Ninguno se veía en el panel.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ UNA RPC Y NO CUATRO CONSULTAS DESDE EL HANDLER
-- ---------------------------------------------------------------------------
-- Porque «coches sin estrenar» es un NOT EXISTS contra daily_cars, y eso desde
-- el cliente de Supabase obliga a traerse los ids de daily_cars al servidor de
-- Node para restarlos en JavaScript. Una función lo cuenta donde están los
-- datos, en un viaje, y además deja el criterio escrito UNA vez y en el mismo
-- sitio donde lo aplica pick_daily_car.
--
-- Revocada para anon/authenticated: la llama el handler admin con service_role.
-- Aunque solo devuelva recuentos —nada que identifique al coche del día, regla
-- 5— «cuántos coches quedan sin estrenar» es información de la casa, no del
-- jugador.

CREATE OR REPLACE FUNCTION public.estado_operativo()
RETURNS TABLE (
  -- Catálogo
  cars_sin_estrenar        int,  -- con foto y nunca han salido → días de vida
  cars_borradores          int,  -- sin foto: no pueden salir todavía
  cars_total               int,
  -- Calendario
  dias_programados         int,  -- filas de daily_cars de hoy en adelante
  dias_sin_foto            int,  -- de esos, cuántos con un coche SIN imagen
  primer_dia_sin_foto      date,
  -- Temporadas
  temporada_numero         int,
  temporada_label          text,
  temporada_fin            date,
  temporada_dias_restantes int,
  siguiente_numero         int,
  siguiente_inicio         date,
  hueco_dias               int   -- días descubiertos entre una y otra
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH hoy AS (
    SELECT (now() AT TIME ZONE 'Europe/Madrid')::date AS d
  ),
  actual AS (
    SELECT * FROM public.current_season()
  ),
  siguiente AS (
    -- La primera temporada que empieza DESPUÉS de la actual. Si no hay actual,
    -- la primera que empiece después de hoy — así el aviso también sirve
    -- estando ya dentro de un hueco.
    SELECT s.* FROM public.seasons s, hoy
    WHERE s.starts_at > COALESCE((SELECT a.ends_at FROM actual a), hoy.d)
    ORDER BY s.starts_at
    LIMIT 1
  ),
  sin_foto AS (
    SELECT dc.date
    FROM public.daily_cars dc
    JOIN public.cars c ON c.id = dc.car_id, hoy
    WHERE dc.date >= hoy.d
      AND c.image_ready IS DISTINCT FROM true
  )
  SELECT
    (SELECT count(*)::int FROM public.cars c
      WHERE c.image_ready = true
        AND NOT EXISTS (SELECT 1 FROM public.daily_cars dc WHERE dc.car_id = c.id)),
    (SELECT count(*)::int FROM public.cars c WHERE c.image_ready IS DISTINCT FROM true),
    (SELECT count(*)::int FROM public.cars),

    (SELECT count(*)::int FROM public.daily_cars dc, hoy WHERE dc.date >= hoy.d),
    (SELECT count(*)::int FROM sin_foto),
    (SELECT min(date) FROM sin_foto),

    (SELECT a.number FROM actual a),
    (SELECT a.label_es FROM actual a),
    (SELECT a.ends_at FROM actual a),
    -- Días que le quedan CONTANDO HOY: una temporada que acaba hoy tiene 1 día,
    -- no 0. Un 0 aquí significaría «ya se acabó», y eso es otra cosa.
    (SELECT (a.ends_at - hoy.d + 1)::int FROM actual a, hoy),

    (SELECT s.number FROM siguiente s),
    (SELECT s.starts_at FROM siguiente s),
    -- Hueco = días sin ninguna temporada entre el fin de la actual y el inicio
    -- de la siguiente. 0 = encadenan. NULL = no hay siguiente, que es el caso
    -- que de verdad duele.
    (SELECT (s.starts_at - a.ends_at - 1)::int FROM siguiente s, actual a);
$$;

REVOKE ALL ON FUNCTION public.estado_operativo() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- Verificación
-- ============================================================================
-- Es la misma llamada que hará el panel. Léela como la leerá él:
--   · cars_sin_estrenar         ≈ días de vida del catálogo a 1/día.
--   · dias_sin_foto             DEBE ser 0. Si no, esa jornada dará 500.
--   · temporada_dias_restantes  cuánto queda de la de ahora.
--   · siguiente_inicio          si sale NULL, la escalera se queda vacía.
SELECT * FROM public.estado_operativo();
