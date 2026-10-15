-- scripts/2026-10-15-compensacion-tvr-revertir.sql
--
-- DESHACE scripts/2026-10-15-compensacion-tvr-aplicar.sql: devuelve cada
-- partida y cada fila de stats EXACTAMENTE a la copia guardada antes de aplicar.
--
-- Ojo con el orden de los acontecimientos: si un compensado ya ha jugado el
-- 16-oct, su stats de hoy se calculó SOBRE la compensación, y restaurar la copia
-- del 15 le borraría también esa partida. Por eso esas cuentas se SALTAN y se
-- avisan: revisarlas a mano. El resto se restaura y se borra de la tabla, así
-- que el script se puede ejecutar dos veces sin daño.

BEGIN;

DO $avisos$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM public.compensacion_tvr_20261015 c
  JOIN public.stats s ON s.user_id = c.user_id
  WHERE s.last_played_date > DATE '2026-10-15';
  IF n > 0 THEN
    RAISE NOTICE '% cuentas ya han jugado después del 15-oct: NO se revierten (revisar a mano).', n;
  END IF;
END
$avisos$;

CREATE TEMP TABLE revertibles ON COMMIT DROP AS
SELECT c.*
FROM public.compensacion_tvr_20261015 c
JOIN public.stats s ON s.user_id = c.user_id
WHERE s.last_played_date <= DATE '2026-10-15';

UPDATE public.user_guesses ug
SET guesses = r.guesses_antes,
    status  = r.status_antes,
    updated_at = now()
FROM revertibles r
WHERE ug.id = r.guess_id;

-- Se restauran solo las columnas que tocó el de aplicar, desde la copia.
UPDATE public.stats s
SET total_points     = (r.stats_antes->>'total_points')::int,
    total_wins       = (r.stats_antes->>'total_wins')::int,
    current_streak   = (r.stats_antes->>'current_streak')::int,
    max_streak       = (r.stats_antes->>'max_streak')::int,
    last_played_date = (r.stats_antes->>'last_played_date')::date
FROM revertibles r
WHERE s.user_id = r.user_id;

DELETE FROM public.compensacion_tvr_20261015 c
USING revertibles r
WHERE c.user_id = r.user_id;

COMMIT;

-- Cuando ya no quede nada que revertir:
--   DROP TABLE public.compensacion_tvr_20261015;
