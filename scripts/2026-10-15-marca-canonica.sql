-- scripts/2026-10-15-marca-canonica.sql
-- Una marca, una grafía. El 15-oct-2026 el coche del día entró como «TVR» con
-- el resto del catálogo en «Tvr»; el cupón (GuessForm, `c.marca === marca`) vio
-- dos marcas y el modelo no se podía elegir (compensación:
-- scripts/2026-10-15-compensacion-tvr-*.sql). /api/admin/save-car ya reutiliza
-- la grafía existente; esto lo sostiene en la BD para cualquier otra vía de
-- escritura (SQL a mano, imports).
--
-- Cómo: no puede ser un UNIQUE (muchos coches comparten marca). Es una
-- restricción EXCLUDE: dos filas con la misma clave normalizada (minúsculas,
-- sin espacios sobrantes) no pueden tener `make` distinto. Sin columnas nuevas,
-- así que no hay GRANT que tocar (regla 3).
--
-- PASO 1 (solo lectura). Debe devolver CERO filas. Si devuelve alguna, unifica
-- esas marcas antes del paso 2 o el ALTER fallará.

SELECT lower(regexp_replace(btrim(make), '\s+', ' ', 'g')) AS clave,
       array_agg(DISTINCT make)                            AS grafias,
       count(*)                                            AS coches
FROM public.cars
GROUP BY 1
HAVING count(DISTINCT make) > 1;

-- PASO 2. Restricción.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.cars
  ADD CONSTRAINT cars_make_una_grafia
  EXCLUDE USING gist (
    (lower(regexp_replace(btrim(make), '\s+', ' ', 'g'))) WITH =,
    make WITH <>
  );

-- Revertir:
-- ALTER TABLE public.cars DROP CONSTRAINT IF EXISTS cars_make_una_grafia;
