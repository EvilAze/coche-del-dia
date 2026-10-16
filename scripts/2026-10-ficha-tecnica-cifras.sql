-- scripts/2026-10-ficha-tecnica-cifras.sql
-- LA FICHA TÉCNICA EN CIFRAS: potencia, par, 0-100 y velocidad máxima.
--
-- El bloque «La ficha» del panel de resultado era un párrafo de texto libre
-- (`description`). Las cifras que un aficionado busca primero —510 CV, 600 Nm,
-- 3,9 s— estaban dentro, cuando estaban, mezcladas con la historia del coche.
-- Para pintarlas en grande hacen falta como DATO, no como texto: sacarlas de la
-- descripción con expresiones regulares se descartó por frágil (cada ficha las
-- escribe a su manera: «510 caballos», «510 CV», «375 kW», «0 a 100 en 3,9»…).
--
-- Aplicar en el SQL editor de Supabase. Idempotente (IF NOT EXISTS).
--
-- ⚠️ ANTES DE MERGEAR EL PR QUE LAS LEE. /api/validate-guess y
-- /api/get-daily-car piden estas columnas en su SELECT, y PostgREST responde
-- con error si una columna no existe: con el código desplegado y este script
-- sin ejecutar, validar un intento devolvería 503. El orden es este script →
-- merge → app.
--
-- SE ENCIENDE CON DATOS, NO CON UN DEPLOY. Las cuatro columnas nacen NULL y el
-- código está escrito para que NULL signifique «como hasta ahora»: el panel
-- pinta solo las cifras que existan, y un coche sin ninguna enseña la ficha de
-- siempre. Se rellenan desde el panel interno, coche a coche (EditCarPanel).
--
-- ⚠️ AQUÍ NO VA NINGÚN «GRANT SELECT», Y ES DELIBERADO. Tercera excepción a la
-- regla 3 de CLAUDE.md, con `tags` y `video_id`, y por la regla 5:
--
--   · SON LA FICHA, Y LA FICHA ES DE QUIEN GANA. Igual que `description` (que
--     tampoco tiene GRANT desde supabase-hardening.sql), solo viajan dentro del
--     `reveal` de una partida GANADA. Legibles desde el cliente, el premio se
--     podría leer sin jugar.
--   · Y ACOTARÍAN EL COCHE DEL DÍA. Cruzadas con el catálogo público
--     (/api/list-cars), «potencia_cv no nula» es la lista de coches que el admin
--     ya ha documentado — y se documenta justo antes de que salgan. Y aunque
--     estuvieran todas rellenas, tres cifras de un superdeportivo descartan a
--     media parrilla de utilitarios: es información sobre el coche del día que
--     el jugador no ha ganado.
--
-- El camino único hasta el jugador es el `reveal` (validate-guess al ganar,
-- get-daily-car al recargar una partida ganada), que pasa por service_role y
-- por api/_lib/cifras.js. El panel admin las lee y escribe por
-- /api/admin/save-car, también con service_role. Si algún día alguien las mete
-- en una query del cliente, reventará con «permission denied» — y ese fallo
-- ruidoso es exactamente lo que queremos que pase. test-rls.mjs lo vigila.
--
-- POR QUÉ ESTAS CUATRO Y ESTAS UNIDADES. Son las que trae cualquier ficha de
-- fabricante y las que se pueden comparar entre un Seiscientos y un Veyron. La
-- potencia en CV (caballo de vapor métrico, el PS alemán) porque es la que
-- publica la prensa en España; el 0-100 en km/h por lo mismo. El peso se queda
-- fuera de momento: cada marca lo da con otro criterio (en vacío, en orden de
-- marcha, con o sin conductor) y una cifra que no se puede comparar no aporta.
-- Añadir una quinta es tocar la lista de api/_lib/cifras.js y este fichero.
--
-- LOS RANGOS SON UNA RED, NO UNA OPINIÓN. Están puestos para cazar el error de
-- tecleo (un cero de más, los kW en el campo de los CV, el 0-100 en décimas) y
-- no para juzgar al coche: caben un Ford T y un Koenigsegg. Son los MISMOS que
-- valida api/_lib/cifras.js antes de escribir — si cambias uno, cambia el otro;
-- el panel da un error legible y la BD es la última palabra.


-- ============================================================================
-- [1] Las columnas
-- ============================================================================
-- smallint para las enteras (el mayor valor posible, 5000 Nm, cabe de sobra) y
-- numeric(3,1) para el 0-100: es una cifra con UN decimal por convención («3,9
-- s») y un float la devolvería como 3.9000000953674316.
ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS potencia_cv       smallint,
  ADD COLUMN IF NOT EXISTS par_nm            smallint,
  ADD COLUMN IF NOT EXISTS aceleracion_0_100 numeric(3,1),
  ADD COLUMN IF NOT EXISTS vmax_kmh          smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cars_potencia_cv_rango') THEN
    ALTER TABLE public.cars ADD CONSTRAINT cars_potencia_cv_rango
      CHECK (potencia_cv IS NULL OR potencia_cv BETWEEN 1 AND 3000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cars_par_nm_rango') THEN
    ALTER TABLE public.cars ADD CONSTRAINT cars_par_nm_rango
      CHECK (par_nm IS NULL OR par_nm BETWEEN 1 AND 5000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cars_aceleracion_0_100_rango') THEN
    ALTER TABLE public.cars ADD CONSTRAINT cars_aceleracion_0_100_rango
      CHECK (aceleracion_0_100 IS NULL OR aceleracion_0_100 BETWEEN 1.0 AND 99.9);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cars_vmax_kmh_rango') THEN
    ALTER TABLE public.cars ADD CONSTRAINT cars_vmax_kmh_rango
      CHECK (vmax_kmh IS NULL OR vmax_kmh BETWEEN 10 AND 600);
  END IF;
END $$;

COMMENT ON COLUMN public.cars.potencia_cv IS
  'Potencia en CV (caballo de vapor métrico). SIN grant al cliente: es la ficha, que solo se revela al ganar (regla 5). Viaja en el reveal vía api/_lib/cifras.js.';
COMMENT ON COLUMN public.cars.par_nm IS
  'Par máximo en Nm. SIN grant al cliente (regla 5). Viaja en el reveal vía api/_lib/cifras.js.';
COMMENT ON COLUMN public.cars.aceleracion_0_100 IS
  'Aceleración 0-100 km/h en segundos, un decimal. NULL si el coche no llega a 100. SIN grant al cliente (regla 5). Viaja en el reveal vía api/_lib/cifras.js.';
COMMENT ON COLUMN public.cars.vmax_kmh IS
  'Velocidad máxima en km/h. SIN grant al cliente (regla 5). Viaja en el reveal vía api/_lib/cifras.js.';


-- ============================================================================
-- [2] Comprobación: el cliente NO puede leerlas
-- ============================================================================
-- Se planta si anon o authenticated pueden leer alguna de las cuatro, por la vía
-- que sea (un GRANT de columna, o uno de TABLA que alguien vuelva a poner).
-- Mejor un error aquí, al aplicar, que descubrirlo cuando ya se puede leer el
-- premio sin jugar.
DO $$
DECLARE
  col text;
  rol text;
BEGIN
  FOREACH col IN ARRAY ARRAY['potencia_cv', 'par_nm', 'aceleracion_0_100', 'vmax_kmh'] LOOP
    FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_column_privilege(rol, 'public.cars', col, 'SELECT') THEN
        RAISE EXCEPTION
          '% puede leer cars.%: estas columnas NO llevan GRANT (ver la cabecera de este fichero). Revócalo antes de seguir.',
          rol, col;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Para verlo de un vistazo después de aplicar: cuántos coches tienen ya alguna
-- cifra. Es un recuento y no una lista (regla 20): no dice CUÁLES.
SELECT
  count(*)                                   AS coches,
  count(potencia_cv)                         AS con_potencia,
  count(par_nm)                              AS con_par,
  count(aceleracion_0_100)                   AS con_0_100,
  count(vmax_kmh)                            AS con_vmax
FROM public.cars;
