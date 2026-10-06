-- scripts/2026-10-bonus-racha-previsualizar.sql
--
-- VISTA PREVIA (SOLO LECTURA) de la clasificación con el bonus de racha.
-- No instala nada ni escribe nada: lleva el cálculo del bonus EMBEBIDO, así que
-- se puede ejecutar antes de aplicar scripts/2026-10-bonus-racha-en-clasificacion.sql
-- para ver, con los datos reales, quién sube y quién baja.
--
-- Compara, para la temporada actual (o la semana de transición si no hay
-- ninguna activa, igual que get_season_leaderboard):
--   · la clasificación VIVA (solo puntos base, la que ve hoy el jugador), y
--   · la misma tabla con el bonus de racha sumado.
--
-- Límites de la vista previa: el desempate real es «puntos, fecha de la última
-- victoria, id» y aquí un empate a puntos comparte puesto (RANK), así que en un
-- empate el puesto exacto puede variar en uno. No cambia lo que se quiere ver.

WITH rango AS (
  SELECT
    COALESCE((SELECT starts_at FROM public.current_season()),
             (SELECT week_start FROM public.current_week_range())) AS desde,
    COALESCE((SELECT ends_at FROM public.current_season()),
             (SELECT week_end FROM public.current_week_range()))   AS hasta
),
-- Victorias en la DIARIA (no repesca), de TODA la historia hasta el fin del
-- rango: la racha no se reinicia al empezar la temporada, así que hay que mirar
-- hacia atrás. prev_car_ids = las revisiones del cambio de emergencia.
diarias AS (
  SELECT DISTINCT ug.user_id, ug.date AS fecha
  FROM public.user_guesses ug
  JOIN public.daily_cars dc ON dc.date = ug.date
   AND (ug.car_id = dc.car_id OR ug.car_id = ANY (COALESCE(dc.prev_car_ids, '{}'::uuid[])))
  WHERE ug.status = 'won'
    AND ug.date <= (SELECT hasta FROM rango)
),
-- Islas de días consecutivos: fecha - nº de orden es constante dentro de una
-- racha, y salta en cuanto falta un día o hay una derrota entre medias.
islas AS (
  SELECT d.user_id, d.fecha,
         d.fecha - (ROW_NUMBER() OVER (PARTITION BY d.user_id ORDER BY d.fecha))::int AS grp
  FROM diarias d
),
racha AS (
  SELECT i.user_id, i.fecha,
         ROW_NUMBER() OVER (PARTITION BY i.user_id, i.grp ORDER BY i.fecha) AS dia_de_racha
  FROM islas i
),
bonus_por_dia AS (
  SELECT r.user_id, r.fecha,
         CASE WHEN r.dia_de_racha >= 4 THEN 3
              WHEN r.dia_de_racha  = 3 THEN 2
              WHEN r.dia_de_racha  = 2 THEN 1
              ELSE 0 END AS bonus
  FROM racha r
  WHERE r.fecha BETWEEN (SELECT desde FROM rango) AND (SELECT hasta FROM rango)
),
bonus AS (
  SELECT b.user_id, SUM(b.bonus)::int AS bonus
  FROM bonus_por_dia b
  GROUP BY b.user_id
),
actual AS (
  SELECT * FROM public.get_season_leaderboard(NULL, 1000000)
),
nuevo AS (
  SELECT a.user_id, a.display_name,
         a.rank                       AS puesto_actual,
         a.total_points               AS pts_actuales,
         COALESCE(b.bonus, 0)         AS bonus,
         a.total_points + COALESCE(b.bonus, 0) AS pts_nuevos
  FROM actual a
  LEFT JOIN bonus b ON b.user_id = a.user_id
)
SELECT
  RANK() OVER (ORDER BY n.pts_nuevos DESC)                       AS puesto_nuevo,
  n.puesto_actual,
  n.puesto_actual - RANK() OVER (ORDER BY n.pts_nuevos DESC)     AS sube,   -- >0 sube, <0 baja
  n.display_name,
  n.pts_actuales,
  n.bonus,
  n.pts_nuevos
FROM nuevo n
ORDER BY n.pts_nuevos DESC, n.puesto_actual
LIMIT 50;
