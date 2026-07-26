-- scripts/2026-07-temporada-le-mans.sql
-- CONTENIDO para la temporada temática «24 Horas»: 24 coches de Le Mans que
-- entran como BORRADOR (image_ready=FALSE, image_url=NULL) ya etiquetados con
-- `le-mans`. NO son elegibles como coche del día hasta que les subas foto desde
-- /admin-tools — en ese momento save-car.js flipa image_ready a TRUE y el pool
-- de la temporada crece solo. Mismo patrón que 2026-05-batch-200-cars.sql.
--
-- REQUISITO: scripts/2026-07-temporadas-tematicas.sql aplicado (necesita que
-- exista la columna `cars.tags`). Si no lo has aplicado, este script falla con
-- «column "tags" does not exist» y no escribe nada.
--
-- Idempotente: se puede re-ejecutar. Los coches se insertan solo si no existe
-- ya uno con la misma marca+modelo, y la etiqueta se añade sin duplicar.
--
-- ---------------------------------------------------------------------------
-- CONVENCIÓN DE AÑO — LÉELA ANTES DE AÑADIR MÁS COCHES DE CARRERAS
-- ---------------------------------------------------------------------------
-- Un coche de competición no tiene UN año: un Porsche 962 corrió de 1984 a
-- 1994. La convención de este catálogo es el **año de debut** del coche, no el
-- de su victoria más famosa. Con el margen de ±2 de compare-guess (ver
-- ANIO_CORRECT_MARGIN) queda justo para el jugador.
--
-- Es imprescindible ser consistente: si unos coches llevan el año de debut y
-- otros el de su victoria, la flecha del año empieza a mentir y nadie sabrá
-- por qué. Ejemplo del criterio aplicado: el Renault Alpine A442 va con 1976
-- (debut) aunque ganara en 1978.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ ESTA LISTA Y NO OTRA
-- ---------------------------------------------------------------------------
-- Le Mans tiene dos riesgos para ESTE juego, y la selección los esquiva:
--
--   1. Los prototipos se parecen entre sí en un recorte cerrado. Un flanco de
--      956 y uno de 962 son casi el mismo flanco. Por eso va SOLO el 956, y la
--      lista alterna deliberadamente carrocerías: barchettas de los 50, cupés
--      de los 60, prototipos Grupo C, GT1 (siluetas de coche de calle, que
--      contrastan) y LMP híbridos. La variedad de silueta es lo que hace que
--      el zoom escalonado funcione.
--
--   2. Reparto por país. Alemania domina la historia real de la carrera, pero
--      un pool medio alemán convierte la pista de «mismo país» en ruido. Se ha
--      recortado a 6 alemanes de 24, con 6 países representados:
--      Reino Unido 5 · Italia 4 · Alemania 6 · Francia 4 · Japón 3 · EE.UU. 2
--
-- Rango de años: 1954-2023. Es el gran punto fuerte del tema — la pista del
-- año sigue dando información, al contrario que en un tema de época cerrada.
--
-- ---------------------------------------------------------------------------
-- OJO CON LAS MARCAS DE UN SOLO COCHE
-- ---------------------------------------------------------------------------
-- Los logros de marca son PARAMÉTRICOS al catálogo (api/_lib/achievements.js):
-- al añadir una marca nueva aparece sola su «Coleccionista de [marca]». Y
-- BRAND_TIERS da plata al 50% y oro al 100% → una marca con UN coche regala un
-- oro por desbloquear ese coche.
--
-- Esta lista añade cinco marcas nuevas con un solo coche: Aston Martin,
-- Bentley, McLaren, Chevrolet y Matra. Decide tú si te importa:
--   · Si te importa, sube esas cinco a 2-3 coches cada una con modelos de calle
--     (DB5, Continental GT, F1, Corvette C2, Bagheera) y el logro deja de ser
--     gratis. Es contenido que además refuerza el catálogo general.
--   · Si no, no pasa nada grave: son cinco oros fáciles entre muchos.
--
-- El Sauber-Mercedes C9 va como marca «Mercedes-Benz» (y no «Sauber») a
-- propósito: era el esfuerzo oficial de Mercedes y así la colección de la marca
-- sigue siendo significativa en vez de crear otra marca de un solo coche.
-- =============================================================================


-- =============================================================================
-- [1] INSERT de los borradores + etiquetado de los que ya existieran
-- =============================================================================
-- Una sola sentencia con dos partes:
--   · el CTE `ins` inserta los que NO existen, ya con tags={le-mans}
--   · el UPDATE final etiqueta los que YA estaban en catálogo (p.ej. el Mazda
--     787B y el Mercedes CLK GTR del batch de 200), sin duplicar la etiqueta
--
-- El UPDATE no ve las filas del CTE (misma snapshot), y no hace falta: esas ya
-- nacen etiquetadas en el INSERT.
--
-- El match es por lower(marca)+lower(modelo) para no crear duplicados por una
-- diferencia de capitalización.
WITH wanted(make, model, year, pais) AS (
  VALUES
    -- Reino Unido (5)
    ('Jaguar',        'D-Type',              1954, 'Reino Unido'),
    ('Aston Martin',  'DBR1',                1956, 'Reino Unido'),
    ('Jaguar',        'XJR-9',               1988, 'Reino Unido'),
    ('McLaren',       'F1 GTR',              1995, 'Reino Unido'),
    ('Bentley',       'Speed 8',             2003, 'Reino Unido'),
    -- Italia (4)
    ('Ferrari',       '250 Testa Rossa',     1957, 'Italia'),
    ('Ferrari',       '330 P4',              1967, 'Italia'),
    ('Lancia',        'LC2',                 1983, 'Italia'),
    ('Ferrari',       '499P',                2023, 'Italia'),
    -- Alemania (6)
    ('Porsche',       '917',                 1969, 'Alemania'),
    ('Porsche',       '956',                 1982, 'Alemania'),
    ('Mercedes-Benz', 'Sauber-Mercedes C9',  1987, 'Alemania'),
    ('Porsche',       '911 GT1',             1996, 'Alemania'),
    ('Audi',          'R10 TDI',             2006, 'Alemania'),
    ('Porsche',       '919 Hybrid',          2014, 'Alemania'),
    -- Francia (4)
    ('Matra',         'MS670',               1972, 'Francia'),
    ('Renault',       'Alpine A442',         1976, 'Francia'),
    ('Peugeot',       '905',                 1990, 'Francia'),
    ('Peugeot',       '908 HDi FAP',         2007, 'Francia'),
    -- Japón (3)
    ('Mazda',         '787B',                1991, 'Japón'),
    ('Nissan',        'R390 GT1',            1997, 'Japón'),
    ('Toyota',        'TS050 Hybrid',        2016, 'Japón'),
    -- EE.UU. (2)
    ('Ford',          'GT40',                1964, 'EE.UU.'),
    ('Chevrolet',     'Corvette C5-R',       1999, 'EE.UU.')
),
ins AS (
  INSERT INTO public.cars (make, model, year, pais, image_ready, image_url, tags)
  SELECT w.make, w.model, w.year, w.pais, FALSE, NULL, ARRAY['le-mans']
  FROM wanted w
  WHERE NOT EXISTS (
    SELECT 1 FROM public.cars c
    WHERE lower(c.make) = lower(w.make)
      AND lower(c.model) = lower(w.model)
  )
  RETURNING id
)
UPDATE public.cars c
SET tags = array_append(c.tags, 'le-mans')
FROM wanted w
WHERE lower(c.make) = lower(w.make)
  AND lower(c.model) = lower(w.model)
  AND NOT ('le-mans' = ANY(COALESCE(c.tags, '{}'::text[])));


-- =============================================================================
-- [2] VERIFICACIÓN (read-only)
-- =============================================================================
-- a) Los 24 están y llevan la etiqueta. `listo` = ya tiene foto y por tanto
--    cuenta para el pool de la temporada.
SELECT
  make, model, year, pais,
  image_ready AS listo,
  tags
FROM public.cars
WHERE 'le-mans' = ANY(tags)
ORDER BY year;

-- b) El pool REAL de la temporada (solo cuenta image_ready = true). Es el mismo
--    número que te pinta el aviso del panel de Temporadas. Arranca la temporada
--    cuando `unseen` cubra los días que quieras darle.
SELECT * FROM season_pool_stats('{"tags":["le-mans"]}'::jsonb);

-- c) Reparto por país del pool ya subido, para vigilar que no se desequilibre
--    mientras vas subiendo fotos (si acabas con 5 de 6 alemanes, la pista de
--    «mismo país» deja de informar durante toda la temporada).
SELECT pais, count(*) AS total, count(*) FILTER (WHERE image_ready) AS listos
FROM public.cars
WHERE 'le-mans' = ANY(tags)
GROUP BY pais
ORDER BY total DESC;


-- =============================================================================
-- [3] CREAR LA TEMPORADA — NO hace falta SQL
-- =============================================================================
-- Hazlo desde /admin-tools → pestaña «Temporadas»:
--   Rótulo ES: «24 Horas»          (alternativa más editorial: «La Sarthe»)
--   Rótulo EN: «24 Hours»
--   Etiquetas: le-mans
--   Fechas:    empieza con 7-10 días y alarga el `ends_at` si el pool crece
--
-- El aviso bajo el formulario te dirá si el pool cubre los días antes de que te
-- comprometas. Y OJO con el orden: si ya has abierto la pestaña Calendario, los
-- próximos 14 días están fijados en daily_cars y la temporada NO se aplicará a
-- ellos (el primer escalón de pick_daily_car es «día ya fijado manda»). Hay que
-- liberar esos días futuros ANTES de que arranque la temporada.
