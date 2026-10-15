-- scripts/2026-10-15-compensacion-tvr-aplicar.sql
--
-- COMPENSA a quien el 15-oct se quedó sin poder elegir el coche del día por el
-- duplicado de marca «TVR» / «Tvr». Qué pasó y la regla de la compensación, en
-- la cabecera de 2026-10-15-compensacion-tvr-previsualizar.sql — ejecútalo
-- ANTES y revisa sus filas: este script aplica EXACTAMENTE esas.
--
-- CUÁNDO: lo antes posible, y en todo caso antes de que los afectados jueguen
-- el 16-oct. Quien ya tenga una partida registrada posterior se SALTA (caso
-- 'saltar'): su racha del 16 se calculó sobre la derrota y reescribir el 15
-- descuadraría las dos. Si lo ejecutas antes de medianoche (Madrid), las
-- partidas «a medias» pasan a ganadas y ya no se pueden seguir jugando: es lo
-- que se quiere.
--
-- REVERSIBLE: cada fila tocada se copia ANTES en compensacion_tvr_20261015, y
-- 2026-10-15-compensacion-tvr-revertir.sql la devuelve tal cual.
--
-- NO idempotente a ciegas, así que se protege: si la tabla de copia ya tiene
-- filas, se planta sin tocar nada (aplicarlo dos veces sumaría puntos dos veces).
--
-- Lo que NO hace: no toca guess_audit (es el registro de lo que pasó de verdad
-- y es justo la prueba del fallo), ni logros, ni podios sellados.

BEGIN;

CREATE TABLE IF NOT EXISTS public.compensacion_tvr_20261015 (
  user_id            uuid PRIMARY KEY,
  guess_id           uuid NOT NULL,
  caso               text NOT NULL,
  intento_tvr        int  NOT NULL,
  racha_nueva        int  NOT NULL,
  puntos_extra       int  NOT NULL,
  victoria_extra     int  NOT NULL,
  -- Copias íntegras de antes, para revertir sin reconstruir nada.
  guesses_antes      jsonb NOT NULL,
  status_antes       text  NOT NULL,
  stats_antes        jsonb NOT NULL,
  aplicado_en        timestamptz NOT NULL DEFAULT now()
);
-- Deny-all: guarda qué días jugó cada cuenta. Solo service_role.
ALTER TABLE public.compensacion_tvr_20261015 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.compensacion_tvr_20261015 FROM PUBLIC, anon, authenticated;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.compensacion_tvr_20261015) THEN
    RAISE EXCEPTION 'La compensación ya está aplicada (compensacion_tvr_20261015 tiene filas). Revierte antes de repetir.';
  END IF;
END
$guard$;

-- Quien nunca había terminado una partida no tiene fila en stats, y el JOIN de
-- la selección lo dejaría fuera EN SILENCIO (el 15-oct, una cuenta). Se le crea
-- vacía, igual que hace record_daily_result antes de puntuar.
INSERT INTO public.stats (user_id)
SELECT DISTINCT a.user_id
FROM public.guess_audit a
WHERE a.game_date = DATE '2026-10-15' AND a.mode = 'daily'
  AND a.guess_make = 'Tvr' AND a.user_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- [1] Selección — MISMO CTE que -previsualizar.sql (mantener en sync)
-- ---------------------------------------------------------------------------
INSERT INTO public.compensacion_tvr_20261015
  (user_id, guess_id, caso, intento_tvr, racha_nueva, puntos_extra,
   victoria_extra, guesses_antes, status_antes, stats_antes)
WITH params AS (
  SELECT DATE '2026-10-15' AS dia
),
hoy AS (
  SELECT dc.car_id FROM public.daily_cars dc, params WHERE dc.date = params.dia
),
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
  SELECT t.user_id, t.intento_tvr, ug.id AS guess_id, ug.status, ug.guesses,
         jsonb_array_length(ug.guesses) AS intentos
  FROM tvr t
  JOIN public.user_guesses ug
    ON ug.user_id = t.user_id
   AND ug.date = (SELECT dia FROM params)
   AND ug.car_id = (SELECT car_id FROM hoy)
),
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
  SELECT p.*, s.current_streak, s.last_played_date, to_jsonb(s) AS stats_json,
         COALESCE(r.dias, 0) AS racha_reconstruida,
         CASE p.intento_tvr WHEN 1 THEN 10 WHEN 2 THEN 6 WHEN 3 THEN 4
                            WHEN 4 THEN 3 WHEN 5 THEN 2 ELSE 0 END AS base_nueva,
         CASE WHEN p.status = 'won' THEN
           CASE p.intentos WHEN 1 THEN 10 WHEN 2 THEN 6 WHEN 3 THEN 4
                           WHEN 4 THEN 3 WHEN 5 THEN 2 ELSE 0 END
         ELSE 0 END AS base_vieja
  FROM partida p
  JOIN public.stats s ON s.user_id = p.user_id
  LEFT JOIN racha_ayer r ON r.user_id = p.user_id
  WHERE p.status <> 'won' OR p.intentos > p.intento_tvr
),
calc AS (
  SELECT b.*,
    CASE
      WHEN b.last_played_date > (SELECT dia FROM params) THEN 'saltar'
      WHEN b.status = 'won'                               THEN 'gano_tarde'
      WHEN b.last_played_date = (SELECT dia FROM params)  THEN 'perdio'
      ELSE 'sin_registrar'
    END AS caso
  FROM base b
),
final AS (
  SELECT c.*,
    CASE c.caso
      WHEN 'gano_tarde'    THEN c.current_streak
      WHEN 'perdio'        THEN c.racha_reconstruida + 1
      WHEN 'sin_registrar' THEN
        CASE WHEN c.last_played_date = (SELECT dia FROM params) - 1
              AND c.current_streak > 0 THEN c.current_streak + 1 ELSE 1 END
      ELSE c.current_streak
    END AS racha_nueva
  FROM calc c
)
SELECT f.user_id, f.guess_id, f.caso, f.intento_tvr, f.racha_nueva,
       -- Puntos que se suman a stats.total_points.
       f.base_nueva - f.base_vieja
         + CASE WHEN f.caso IN ('perdio', 'sin_registrar') THEN
             CASE WHEN f.racha_nueva >= 4 THEN 3 WHEN f.racha_nueva = 3 THEN 2
                  WHEN f.racha_nueva = 2 THEN 1 ELSE 0 END
           ELSE 0 END,
       CASE WHEN f.caso IN ('perdio', 'sin_registrar') THEN 1 ELSE 0 END,
       f.guesses, f.status, f.stats_json
FROM final f
WHERE f.caso <> 'saltar';

-- Los saltados se cuentan para que no pasen desapercibidos.
DO $avisos$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.compensacion_tvr_20261015;
  RAISE NOTICE 'Compensación: % cuentas. Las del caso «saltar» de la previsualización NO se han tocado.', n;
END
$avisos$;

-- ---------------------------------------------------------------------------
-- [2] La partida: intentos hasta el primero con «Tvr» (exclusive) + victoria
-- ---------------------------------------------------------------------------
-- El intento sintético tiene la MISMA forma que escribe compare-guess.js (es
-- contrato con el cliente: GuessRow lo pinta tal cual). Se toma el coche de
-- cars y no un literal, para que este fichero no ate en el repo más de lo que
-- ya es público en el Archivo.
UPDATE public.user_guesses ug
SET guesses = (
      SELECT COALESCE(jsonb_agg(e.val ORDER BY e.ord), '[]'::jsonb)
      FROM jsonb_array_elements(c.guesses_antes) WITH ORDINALITY AS e(val, ord)
      WHERE e.ord < c.intento_tvr
    ) || jsonb_build_array(jsonb_build_object(
      'win',    true,
      'marca',  jsonb_build_object('val', car.make, 'pais', car.pais, 'status', 'correct'),
      'modelo', jsonb_build_object('val', car.model, 'status', 'correct'),
      'anio',   jsonb_build_object('val', car.year::text, 'status', 'correct', 'direction', null)
    )),
    status = 'won',
    updated_at = now()
FROM public.compensacion_tvr_20261015 c
JOIN public.cars car ON car.id = (SELECT car_id FROM public.daily_cars WHERE date = DATE '2026-10-15')
WHERE ug.id = c.guess_id;

-- ---------------------------------------------------------------------------
-- [3] stats: la victoria, los puntos y la racha
-- ---------------------------------------------------------------------------
UPDATE public.stats s
SET total_points     = s.total_points + c.puntos_extra,
    total_wins       = s.total_wins + c.victoria_extra,
    current_streak   = c.racha_nueva,
    max_streak       = GREATEST(s.max_streak, c.racha_nueva),
    last_played_date = DATE '2026-10-15'
FROM public.compensacion_tvr_20261015 c
WHERE s.user_id = c.user_id;

-- Comprobación: todas las partidas compensadas quedan ganadas en el intento
-- previsto. Si no, se deshace la transacción entera.
DO $check$
DECLARE malas int;
BEGIN
  SELECT count(*) INTO malas
  FROM public.compensacion_tvr_20261015 c
  JOIN public.user_guesses ug ON ug.id = c.guess_id
  WHERE ug.status <> 'won' OR jsonb_array_length(ug.guesses) <> c.intento_tvr;
  IF malas > 0 THEN
    RAISE EXCEPTION 'Comprobación fallida en % partidas: no se aplica nada.', malas;
  END IF;
END
$check$;

COMMIT;
