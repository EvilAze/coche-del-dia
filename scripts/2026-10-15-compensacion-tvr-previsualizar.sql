-- scripts/2026-10-15-compensacion-tvr-previsualizar.sql
--
-- PREVISUALIZACIÓN (SOLO LECTURA) de scripts/2026-10-15-compensacion-tvr-aplicar.sql.
-- Ni una escritura: un único SELECT. Ejecútalo en el SQL Editor de Supabase y
-- revisa fila a fila ANTES de aplicar.
--
-- ---------------------------------------------------------------------------
-- QUÉ PASÓ
-- ---------------------------------------------------------------------------
-- El 15-oct el coche del día se subió con marca «TVR», pero los demás TVR del
-- catálogo estaban como «Tvr». El cupón agrupa las marcas por texto EXACTO
-- (GuessForm: `c.marca === marca`), así que había dos marcas: «TVR», con solo el
-- coche del día, y «Tvr», con el resto. Quien elegía «Tvr» no encontraba el
-- modelo y quemaba intentos con los otros dos. El servidor compara sin
-- mayúsculas, así que el fallo era SOLO del cliente y nunca dejó rastro de error:
-- el rastro es guess_audit con guess_make = 'Tvr' (sensible a mayúsculas a
-- propósito: tras unificar el catálogo a «TVR» ya no puede aparecer).
--
-- ---------------------------------------------------------------------------
-- QUÉ SE LES DA (la regla, en una frase)
-- ---------------------------------------------------------------------------
-- La partida se reescribe como si en el PRIMER intento en que eligieron «Tvr»
-- hubieran podido elegir el coche bueno: victoria en ese intento, con sus puntos
-- base y el bonus de la racha que llevaban. Generosa a propósito: no se mira si
-- el año que pusieron caía en el margen — quien eligió esa marca ya había
-- reconocido el coche, y el fallo le quitó la ocasión de afinar el año.
--
-- Por qué reescribir user_guesses y no solo stats: las clasificaciones se
-- recalculan EN VIVO desde user_guesses (status + nº de intentos, y la racha
-- por islas de fechas en bonus_racha_diaria). Tocar solo stats dejaría el perfil
-- y la clasificación contando cosas distintas — el mismo agujero que cerró
-- 2026-10-bonus-racha-en-clasificacion.sql.
--
-- MANTENER EN SYNC el CTE con el de -aplicar.sql: es la misma selección.

WITH params AS (
  SELECT DATE '2026-10-15' AS dia
),
hoy AS (
  SELECT dc.car_id FROM public.daily_cars dc, params WHERE dc.date = params.dia
),
-- Primer intento en que cada jugador eligió «Tvr». Solo cuentas: un anónimo no
-- tiene stats ni clasificación que reparar (y el 15-oct no hubo ninguno).
tvr AS (
  SELECT a.user_id, min(a.attempt_number) AS intento_tvr
  FROM public.guess_audit a, params
  WHERE a.game_date = params.dia
    AND a.mode = 'daily'
    AND a.guess_make = 'Tvr'
    AND a.user_id IS NOT NULL
  GROUP BY a.user_id
),
partida AS (
  SELECT t.user_id, t.intento_tvr, ug.id AS guess_id, ug.status,
         jsonb_array_length(ug.guesses) AS intentos
  FROM tvr t
  JOIN public.user_guesses ug
    ON ug.user_id = t.user_id
   AND ug.date = (SELECT dia FROM params)
   AND ug.car_id = (SELECT car_id FROM hoy)
),
-- Racha que llevaban AYER, reconstruida desde las diarias ganadas (mismo método
-- de islas que bonus_racha_diaria). Hace falta para quien PERDIÓ: su stats ya
-- tiene la racha a 0 y el valor anterior no se guarda en ningún sitio.
diarias AS (
  SELECT DISTINCT g.user_id, g.date
  FROM public.user_guesses g
  JOIN public.daily_cars d ON d.date = g.date
   AND (g.car_id = d.car_id OR g.car_id = ANY (COALESCE(d.prev_car_ids, '{}'::uuid[])))
  WHERE g.status = 'won'
    AND g.user_id IN (SELECT user_id FROM tvr)
    AND g.date < (SELECT dia FROM params)
),
islas AS (
  SELECT user_id, date,
         date - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY date))::int AS grp
  FROM diarias
),
racha_ayer AS (
  SELECT i.user_id, count(*)::int AS dias
  FROM islas i
  WHERE (i.user_id, i.grp) IN (
    SELECT user_id, grp FROM islas WHERE date = (SELECT dia FROM params) - 1
  )
  GROUP BY i.user_id
),
base AS (
  SELECT p.*, s.current_streak, s.max_streak, s.total_points, s.total_wins,
         s.last_played_date,
         COALESCE(r.dias, 0) AS racha_reconstruida,
         CASE p.intento_tvr WHEN 1 THEN 10 WHEN 2 THEN 6 WHEN 3 THEN 4
                            WHEN 4 THEN 3 WHEN 5 THEN 2 ELSE 0 END AS base_nueva,
         CASE WHEN p.status = 'won' THEN
           CASE p.intentos WHEN 1 THEN 10 WHEN 2 THEN 6 WHEN 3 THEN 4
                           WHEN 4 THEN 3 WHEN 5 THEN 2 ELSE 0 END
         ELSE 0 END AS base_vieja
  FROM partida p
  -- LEFT: hay quien nunca había terminado una partida y no tiene fila en stats.
  LEFT JOIN public.stats s ON s.user_id = p.user_id
  LEFT JOIN racha_ayer r ON r.user_id = p.user_id
  -- Quien ganó en ese mismo intento o antes no perdió nada.
  WHERE p.status <> 'won' OR p.intentos > p.intento_tvr
),
calc AS (
  SELECT b.*,
    CASE
      -- Ya registró una partida POSTERIOR: su racha se calculó sobre la
      -- derrota y reescribirla aquí la descuadraría. Se salta y se avisa.
      WHEN b.last_played_date > (SELECT dia FROM params) THEN 'saltar'
      WHEN b.status = 'won'                               THEN 'gano_tarde'
      WHEN b.last_played_date = (SELECT dia FROM params)  THEN 'perdio'
      ELSE 'sin_registrar'   -- a medias: record_daily_result nunca corrió hoy
    END AS caso
  FROM base b
),
final AS (
  SELECT c.*,
    CASE c.caso
      WHEN 'gano_tarde'    THEN c.current_streak
      WHEN 'perdio'        THEN c.racha_reconstruida + 1
      -- Sin registrar: stats sigue en el día anterior y es la fuente fiable,
      -- con la misma regla que record_daily_result («ayer y > 0 → +1»).
      WHEN 'sin_registrar' THEN
        CASE WHEN c.last_played_date = (SELECT dia FROM params) - 1
              AND c.current_streak > 0 THEN c.current_streak + 1 ELSE 1 END
      ELSE c.current_streak
    END AS racha_nueva
  FROM calc c
)
SELECT
  f.user_id,
  pr.display_name        AS nick,
  f.caso,
  f.status               AS estado_hoy,
  f.intentos             AS intentos_hoy,
  f.intento_tvr          AS gana_en_intento,
  f.current_streak       AS racha_ahora,
  f.racha_nueva,
  f.base_nueva - f.base_vieja AS puntos_base_extra,
  CASE WHEN f.caso IN ('perdio', 'sin_registrar') THEN
    CASE WHEN f.racha_nueva >= 4 THEN 3 WHEN f.racha_nueva = 3 THEN 2
         WHEN f.racha_nueva = 2 THEN 1 ELSE 0 END
  ELSE 0 END             AS bonus_racha,
  f.total_points         AS puntos_ahora
FROM final f
LEFT JOIN public.profiles pr ON pr.id = f.user_id
ORDER BY f.caso, f.racha_nueva DESC;
