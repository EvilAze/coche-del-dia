-- scripts/2026-08-temporada-4-pelotillas-atomicas.sql
-- TEMPORADA 4 «Pelotillas atómicas» + TEMPORADA 5 de respaldo (sin temática).
-- Adelanta además el cierre de T3 «Le Mans».
--
-- Aplicar en el SQL editor de Supabase, DESPUÉS de 2026-07-temporadas-tematicas.sql.
-- Idempotente: se puede ejecutar dos veces sin duplicar nada.
--
-- ⚠️ ANTES DE ESTE FICHERO hay que ejecutar el que etiqueta el pool, que NO
-- ESTÁ EN EL REPOSITORIO: scripts/privado/2026-08-pool-pelotillas.sql. Este de
-- aquí arranca comprobando que las 21 filas ya llevan la etiqueta y se planta
-- si no. Ver la sección [0].
--
-- ── POR QUÉ ESTA TEMPORADA Y NO OTRA ──────────────────────────────────────
-- El análisis de agosto (docs/analisis-temporadas-2026-08.md) midió que la
-- temática de Le Mans no hizo el juego más difícil: lo hizo MÁS POLARIZADO. En
-- los mismos 18 jugadores que estaban antes y después, los aciertos al primer
-- intento pasaron del 13% al 32% y los intentos medios de 2,84 a 2,27, mientras
-- la tasa de fallo global subía del 15% al 19% (el recién llegado se estrella
-- donde el veterano acierta a ciegas).
--
-- La causa no es la etiqueta —el nombre de la temporada no explica el pool—
-- sino el POOL mismo: Le Mans concentra marcas de carreras famosas. Medido
-- sobre el histórico de intentos, la marca del día de Le Mans estaba «en la
-- punta de la lengua» del público el 4,0% de las veces, frente al 2,3% del
-- catálogo entero: el tema DUPLICABA la probabilidad de acertar a ciegas.
--
-- «Pelotillas atómicas» está elegida para que eso no pase. Mismo criterio,
-- medido igual: 2,0% — por DEBAJO del catálogo completo. Y respeta los tres
-- ejes de pista del juego (compare-guess.js da marca, país como «partial» y año
-- con margen ±2), porque cruza las tres dimensiones en vez de colapsar una: no
-- concentra marcas, reparte países y estira el rango de años por varias
-- décadas. El detalle numérico va en el análisis; el pool, en el fichero
-- privado.
--
-- Un tema de PAÍS («Coches alemanes») mataría la pista «partial» del chip de
-- marca; uno de DÉCADA mataría el año, que se da por bueno con ±2 años. Por eso
-- los temas que funcionan son transversales, no recortes de una columna de la
-- tabla.
--
-- ── DURACIÓN Y CONSUMO ────────────────────────────────────────────────────
-- 7 días sobre un pool de 21 = se gasta un tercio. Le Mans duró 20 días sobre
-- 24 coches y estuvo a punto de comerse el tema entero. Con un tercio,
-- «Pelotillas atómicas» vuelve dentro de unos meses con coches frescos, que es
-- lo que convierte un tema en una columna del calendario y no en un cartucho de
-- un solo uso.

BEGIN;

-- ============================================================================
-- [0] ¿Está el pool etiquetado?
-- ============================================================================
-- El UPDATE que reparte la etiqueta vive fuera de git, en
-- scripts/privado/2026-08-pool-pelotillas.sql, porque este repositorio es
-- PÚBLICO y la lista de coches de una temporada es justo lo que la regla 20 del
-- CLAUDE.md prohíbe versionar (y lo que la 3 defiende negando el GRANT a
-- `cars.tags`): con el pool a la vista, el espacio de búsqueda de esa semana
-- pasa del catálogo entero a 21 candidatos conocidos.
--
-- Aquí solo se comprueba el RECUENTO. Un número no identifica a nadie —saber
-- que el pool tiene 21 coches no dice cuáles— así que la verificación puede
-- vivir en el repositorio sin filtrar nada, y el fichero público sigue siendo
-- ejecutable de principio a fin sin sorpresas a mitad.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM public.cars
  WHERE image_ready = true AND 'pelotillas' = ANY (tags);
  IF v_n <> 21 THEN
    RAISE EXCEPTION
      'El pool no está etiquetado (% coches con la etiqueta, esperaba 21). Ejecuta antes scripts/privado/2026-08-pool-pelotillas.sql.', v_n;
  END IF;
END $$;

-- ============================================================================
-- [1] Le Mans cierra el 15, no el 19
-- ============================================================================
-- Las temporadas no pueden solaparse (constraint de exclusión seasons_no_overlap),
-- así que para que T4 empiece el 16, T3 tiene que acabar el 15. Va lo PRIMERO
-- de las escrituras: el constraint se comprueba en cada sentencia, no al final
-- de la transacción.
--
-- Efectos: el countdown del banner pasa a «Cierra hoy» (urgencia real, no
-- pérdida) y al día siguiente el warm-daily la cierra sola —
-- close_finished_seasons() recoge cualquier temporada con ends_at < hoy y sin
-- closed_at, así que el podio de Le Mans se congela igual sobre los 20 días que
-- se jugaron de verdad.
--
-- Y hay premio: los 4 coches de Le Mans que quedaban programados vuelven sin
-- jugar al pool general. Tres de ellos son justo los que no tienen imagen — el
-- problema de los 500 de /api/daily-image se cae solo — y el tema deja de estar
-- agotado: le quedan cuatro cartuchos para cuando Le Mans vuelva. La consulta
-- (e) del final los lista, sin necesidad de escribir aquí cuáles son.
UPDATE public.seasons
SET ends_at = DATE '2026-08-15'
WHERE number = 3 AND ends_at > DATE '2026-08-15';

-- ============================================================================
-- [2] Liberar los días ya programados de la ventana de T4
-- ============================================================================
-- El Calendario tenía sorteados hasta el 28 de agosto: los primeros días con lo
-- que quedaba de Le Mans y el resto con coches sueltos del catálogo general.
-- pick_daily_car respeta SIEMPRE lo que ya hay en daily_cars (paso 1 de su
-- escalera), así que sin este borrado la temática no se aplicaría ni un solo
-- día.
--
-- Solo días FUTUROS y sin jugar: del 16 al 22. Los coches liberados no se
-- pierden, vuelven al pool general. Del 23 al 28 se queda como está: caen ya en
-- T5, que no lleva temática.
DELETE FROM public.daily_cars
WHERE date BETWEEN DATE '2026-08-16' AND DATE '2026-08-22';

-- ============================================================================
-- [3] Temporada 4 — «Pelotillas atómicas»
-- ============================================================================
-- Contigua a T3 a propósito: un hueco entre temporadas deja current_season() en
-- NULL, y con eso la clasificación se queda vacía y sin banner.
--
-- El slug del theme_filter sí va aquí: `pelotillas` es una etiqueta, no una
-- lista. Sin el contenido de la etiqueta no acota nada, y el rótulo de la
-- temporada se le enseña al jugador encima de la foto de todas formas.
INSERT INTO public.seasons (number, label_es, label_en, starts_at, ends_at, theme_filter)
SELECT 4, 'Pelotillas atómicas', 'Pocket Rockets',
       DATE '2026-08-16', DATE '2026-08-22',
       '{"tags":["pelotillas"]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.seasons WHERE number = 4);

-- ============================================================================
-- [4] Temporada 5 — el respaldo, SIN temática
-- ============================================================================
-- Existe para que la escalera no se quede nunca vacía, que es el fallo que ha
-- estado a punto de pasar dos veces. Sin filtro: el sorteo vuelve al catálogo
-- completo, que es el comportamiento que el análisis recomienda como DEFECTO
-- (la temática es la especia, no la base).
--
-- Es un marcador de posición editable: cuando la colaboración con PowerArt esté
-- cerrada, se cambian labels + presenta_es/presenta_en + theme_filter desde
-- /admin-tools sin tocar SQL. Con `presenta` relleno, la línea de encima de la
-- foto pasa a dar el crédito de la colaboración en vez del nombre del ciclo.
INSERT INTO public.seasons (number, label_es, label_en, starts_at, ends_at, theme_filter)
SELECT 5, 'Temporada abierta', 'Open Season',
       DATE '2026-08-23', DATE '2026-09-05',
       NULL
WHERE NOT EXISTS (SELECT 1 FROM public.seasons WHERE number = 5);

COMMIT;

-- ============================================================================
-- [5] VERIFICACIÓN. Ejecutar después.
-- ============================================================================
-- ⚠️ TODAS SON DE LECTURA MENOS LA (d): `pick_daily_car` NO es un preview, es
-- el sorteo. Inserta la fila en daily_cars y deja el día FIJADO (por eso es
-- idempotente y por eso puede llamarla el primer jugador que entre). Llamarla
-- para «comprobar» adelanta el sorteo de ese día, que es inofensivo pero
-- conviene saberlo: después de (d), la (a) devuelve unseen = 20 y no 21.
--
-- a) El pool da de sobra para los 7 días (total 21, unseen 21):
--
-- SELECT * FROM season_pool_stats('{"tags":["pelotillas"]}'::jsonb);
--
-- b) El calendario de la temporada está libre para que sortee el tema
--    (0 filas entre el 16 y el 22):
--
-- SELECT date FROM daily_cars WHERE date BETWEEN '2026-08-16' AND '2026-08-22';
--
-- c) No hay hueco entre temporadas ni solapes (T3 hasta el 15, T4 del 16 al 22,
--    T5 del 23 al 5 de septiembre):
--
-- SELECT number, label_es, starts_at, ends_at, theme_filter FROM seasons ORDER BY starts_at;
--
-- d) El coche del primer día ya cae dentro del tema:
--
-- SELECT make, model, year, pais FROM cars WHERE id = pick_daily_car(DATE '2026-08-16');
--
-- e) Le Mans deja cuatro coches sin jugar para una futura vuelta:
--
-- SELECT make, model, year, image_ready FROM cars
-- WHERE 'le-mans' = ANY (tags)
--   AND NOT EXISTS (SELECT 1 FROM daily_cars dc WHERE dc.car_id = cars.id);
