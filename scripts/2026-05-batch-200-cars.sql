-- =============================================================================
-- 2026-05-batch-200-cars.sql
-- =============================================================================
-- Batch para meter 200 coches nuevos al catálogo SIN romper la experiencia
-- de juego: los coches entran con `image_ready=FALSE` y NO son seleccionables
-- por `pick_daily_car` hasta que el admin les suba la imagen (en ese momento
-- el backend de save-car.js flip automáticamente a TRUE).
--
-- Pasos (ejecuta en orden, en el SQL Editor de Supabase):
--   [PASO 0]   Inspecciona el cuerpo actual de pick_daily_car (READ-ONLY)
--              y pégame el resultado si NO se parece a lo que asumo en
--              [PASO 2] — así te genero la versión exacta.
--   [PASO 1]   Schema: añade columna `image_ready` + hace nullable `image_url`
--   [PASO 2]   Reemplaza `pick_daily_car` para filtrar por image_ready=TRUE
--              ⚠️ Verifica que coincide con tu cuerpo actual antes de aplicar.
--   [PASO 3]   Inserta los 200 coches nuevos con image_ready=FALSE
--   [PASO 4]   Libera las asignaciones futuras > hoy+6 para que el RPC
--              vuelva a elegir random (incluyendo nuevos cuando tengan
--              imagen).
--
-- Filosofía: los pasos 1, 3 y 4 son seguros e idempotentes. El paso 2 es el
-- único que reemplaza lógica viva — léelo dos veces antes de aplicarlo.
-- =============================================================================


-- =============================================================================
-- [PASO 0] Inspecciona pick_daily_car actual (READ-ONLY)
-- =============================================================================
-- Copia y pásame el resultado si la firma o lógica difieren de lo asumido
-- en [PASO 2]. Si el resultado es similar (selecciona aleatoriamente de
-- cars con un NOT IN sobre daily_cars), [PASO 2] funciona tal cual.

SELECT pg_get_functiondef(p.oid) AS current_body
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'pick_daily_car';


-- =============================================================================
-- [PASO 1] Schema: columna image_ready + image_url nullable
-- =============================================================================
-- Aditivo y seguro. Los 203 coches existentes quedan con image_ready=TRUE
-- por el DEFAULT, así que su comportamiento NO cambia. Idempotente: usar
-- IF NOT EXISTS para poder re-ejecutar sin error.

ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS image_ready BOOLEAN NOT NULL DEFAULT TRUE;

-- Permitimos image_url NULL para los coches "borrador" (todavía sin foto).
-- Si tu schema ya lo tiene nullable, este ALTER es no-op.
ALTER TABLE public.cars
  ALTER COLUMN image_url DROP NOT NULL;

-- Índice parcial: pick_daily_car va a leer `WHERE image_ready=TRUE` y un
-- index parcial sobre esa condición es ínfimo (200 falsos vs 200 trues
-- actualmente) pero acelera la query random aunque crezca el catálogo.
CREATE INDEX IF NOT EXISTS cars_image_ready_idx
  ON public.cars (id) WHERE image_ready = TRUE;


-- =============================================================================
-- [PASO 2] Reemplaza pick_daily_car (FILTRA POR image_ready=TRUE)
-- =============================================================================
-- Adaptado al cuerpo ACTUAL del RPC (verificado vía PASO 0). Mantiene
-- TODA la lógica original — incluido el fallback de catálogo agotado y
-- el re-read tras race condition — y solo añade `image_ready = TRUE`
-- en los dos SELECT que escogen coche (el principal y el fallback).
--
-- Por qué ambos selects: si solo filtramos el principal, cuando el
-- catálogo "ready" se agote, el fallback podría sacar un coche borrador
-- sin imagen → coche del día roto. Filtrando los dos, el peor caso es
-- repetir un coche ya jugado (que sí tiene imagen) — exactamente el
-- comportamiento defensivo que ya tenías.

CREATE OR REPLACE FUNCTION public.pick_daily_car(p_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_car_id uuid;
begin
  -- 1) Camino feliz: ya hay coche fijado para este día.
  select car_id into v_car_id from daily_cars where date = p_date;
  if v_car_id is not null then
    return v_car_id;
  end if;

  -- 2) Primer hit del día: aleatorio puro entre coches CON IMAGEN LISTA
  --    que NUNCA han salido. random() de Postgres no es predecible desde
  --    el frontend porque la semilla del PRNG la maneja el motor, no se
  --    exporta. El filtro image_ready=TRUE es la NUEVA condición — coches
  --    en draft (sin imagen subida todavía) NO entran en el sorteo.
  select c.id into v_car_id
  from cars c
  where c.image_ready = true
    and not exists (
      select 1 from daily_cars dc where dc.car_id = c.id
    )
  order by random()
  limit 1;

  -- 3) Fallback: catálogo "ready" agotado. Mejor un coche repetido al azar
  --    (con imagen) que un error 500. También filtramos image_ready aquí
  --    — un draft sin imagen rompería el daily aunque cubriéramos el 500.
  if v_car_id is null then
    select id into v_car_id
    from cars
    where image_ready = true
    order by random()
    limit 1;
  end if;

  if v_car_id is null then
    raise exception 'No cars in catalog';
  end if;

  -- 4) Lock: si dos requests llegan a la vez, gana el primero que inserta.
  insert into daily_cars (date, car_id)
  values (p_date, v_car_id)
  on conflict (date) do nothing;

  -- 5) Releer por si perdimos la carrera contra otro request concurrente:
  --    el v_car_id local puede ser distinto del que finalmente quedó fijado.
  select car_id into v_car_id from daily_cars where date = p_date;
  return v_car_id;
end;
$function$;

-- Re-aplicar las revocaciones del hardening (CREATE OR REPLACE resetea ACLs).
REVOKE EXECUTE ON FUNCTION public.pick_daily_car(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pick_daily_car(date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pick_daily_car(date) FROM authenticated;


-- =============================================================================
-- [PASO 3] Inserta los 200 coches nuevos (image_ready=FALSE, image_url=NULL)
-- =============================================================================
-- Todos llevan image_ready=FALSE: NO son seleccionables por pick_daily_car
-- hasta que les subas imagen vía /admin-tools (save-car.js auto-flip a TRUE).
-- image_url=NULL para no contaminar el catálogo con URLs falsas.

INSERT INTO public.cars (make, model, year, pais, image_ready, image_url) VALUES
  -- Alemania (45)
  ('Audi', 'A8 W12', 2005, 'Alemania', FALSE, NULL),
  ('Audi', 'RS3 Sportback', 2017, 'Alemania', FALSE, NULL),
  ('Audi', 'TT Mk1', 1998, 'Alemania', FALSE, NULL),
  ('Audi', 'S2 Coupe', 1991, 'Alemania', FALSE, NULL),
  ('Audi', 'V8 Quattro', 1988, 'Alemania', FALSE, NULL),
  ('Audi', 'A2', 2000, 'Alemania', FALSE, NULL),
  ('Audi', '80', 1986, 'Alemania', FALSE, NULL),
  ('BMW', 'M3 E46', 2000, 'Alemania', FALSE, NULL),
  ('BMW', 'M5 E60', 2005, 'Alemania', FALSE, NULL),
  ('BMW', 'M2', 2016, 'Alemania', FALSE, NULL),
  ('BMW', '3.0 CSL', 1972, 'Alemania', FALSE, NULL),
  ('BMW', 'i3', 2013, 'Alemania', FALSE, NULL),
  ('BMW', 'Z3 M', 1997, 'Alemania', FALSE, NULL),
  ('BMW', '2002 Tii', 1971, 'Alemania', FALSE, NULL),
  ('BMW', 'M1', 1978, 'Alemania', FALSE, NULL),
  ('BMW', '850 CSi', 1992, 'Alemania', FALSE, NULL),
  ('Mercedes-Benz', '190E 2.3-16', 1984, 'Alemania', FALSE, NULL),
  ('Mercedes-Benz', 'E55 AMG', 1997, 'Alemania', FALSE, NULL),
  ('Mercedes-Benz', 'CLK GTR', 1997, 'Alemania', FALSE, NULL),
  ('Mercedes-Benz', 'AMG GT', 2014, 'Alemania', FALSE, NULL),
  ('Mercedes-Benz', '600 Pullman', 1963, 'Alemania', FALSE, NULL),
  ('Mercedes-Benz', 'W124', 1984, 'Alemania', FALSE, NULL),
  ('Mercedes-Benz', 'AMG ONE', 2022, 'Alemania', FALSE, NULL),
  ('Mercedes-Benz', 'C63 AMG', 2008, 'Alemania', FALSE, NULL),
  ('Mercedes-Benz', '280 SL Pagoda', 1963, 'Alemania', FALSE, NULL),
  ('Porsche', '944 Turbo', 1985, 'Alemania', FALSE, NULL),
  ('Porsche', '968', 1991, 'Alemania', FALSE, NULL),
  ('Porsche', 'Boxster', 1996, 'Alemania', FALSE, NULL),
  ('Porsche', 'Cayman GT4', 2015, 'Alemania', FALSE, NULL),
  ('Porsche', 'Macan Turbo', 2014, 'Alemania', FALSE, NULL),
  ('Porsche', '928 GTS', 1991, 'Alemania', FALSE, NULL),
  ('Porsche', '911 GT3 RS', 2018, 'Alemania', FALSE, NULL),
  ('Porsche', 'Panamera Turbo', 2009, 'Alemania', FALSE, NULL),
  ('Volkswagen', 'Corrado VR6', 1991, 'Alemania', FALSE, NULL),
  ('Volkswagen', 'Golf R32', 2002, 'Alemania', FALSE, NULL),
  ('Volkswagen', 'Touareg V10 TDI', 2002, 'Alemania', FALSE, NULL),
  ('Volkswagen', 'Phaeton W12', 2002, 'Alemania', FALSE, NULL),
  ('Volkswagen', 'Polo GTI', 2018, 'Alemania', FALSE, NULL),
  ('Volkswagen', 'Lupo GTI', 2000, 'Alemania', FALSE, NULL),
  ('Volkswagen', 'Karmann Ghia', 1955, 'Alemania', FALSE, NULL),
  ('Opel', 'Astra OPC', 2005, 'Alemania', FALSE, NULL),
  ('Opel', 'Manta GT/E', 1977, 'Alemania', FALSE, NULL),
  ('Opel', 'Speedster', 2000, 'Alemania', FALSE, NULL),
  ('Opel', 'Corsa OPC', 2007, 'Alemania', FALSE, NULL),
  ('Smart', 'Roadster Brabus', 2003, 'Alemania', FALSE, NULL),

  -- Italia (30)
  ('Ferrari', '458 Italia', 2009, 'Italia', FALSE, NULL),
  ('Ferrari', '360 Modena', 1999, 'Italia', FALSE, NULL),
  ('Ferrari', 'F50', 1995, 'Italia', FALSE, NULL),
  ('Ferrari', '288 GTO', 1984, 'Italia', FALSE, NULL),
  ('Ferrari', '308 GTB', 1975, 'Italia', FALSE, NULL),
  ('Ferrari', 'Daytona', 1968, 'Italia', FALSE, NULL),
  ('Ferrari', 'Dino 246 GT', 1969, 'Italia', FALSE, NULL),
  ('Lamborghini', 'Aventador', 2011, 'Italia', FALSE, NULL),
  ('Lamborghini', 'Huracán', 2014, 'Italia', FALSE, NULL),
  ('Lamborghini', 'Gallardo', 2003, 'Italia', FALSE, NULL),
  ('Lamborghini', 'Murciélago', 2001, 'Italia', FALSE, NULL),
  ('Lamborghini', 'Urus', 2018, 'Italia', FALSE, NULL),
  ('Lamborghini', 'Espada', 1968, 'Italia', FALSE, NULL),
  ('Lamborghini', 'LM002', 1986, 'Italia', FALSE, NULL),
  ('Alfa Romeo', '33 Stradale', 1967, 'Italia', FALSE, NULL),
  ('Alfa Romeo', 'Giulia Quadrifoglio', 2015, 'Italia', FALSE, NULL),
  ('Alfa Romeo', 'Spider Duetto', 1966, 'Italia', FALSE, NULL),
  ('Alfa Romeo', 'SZ', 1989, 'Italia', FALSE, NULL),
  ('Alfa Romeo', '156 GTA', 2001, 'Italia', FALSE, NULL),
  ('Lancia', 'Fulvia', 1963, 'Italia', FALSE, NULL),
  ('Lancia', 'Beta Montecarlo', 1975, 'Italia', FALSE, NULL),
  ('Fiat', 'Barchetta', 1995, 'Italia', FALSE, NULL),
  ('Fiat', '124 Spider', 1966, 'Italia', FALSE, NULL),
  ('Fiat', 'X1/9', 1972, 'Italia', FALSE, NULL),
  ('Maserati', 'Bora', 1971, 'Italia', FALSE, NULL),
  ('Maserati', 'MC20', 2020, 'Italia', FALSE, NULL),
  ('Maserati', 'Ghibli', 2013, 'Italia', FALSE, NULL),
  ('De Tomaso', 'Mangusta', 1967, 'Italia', FALSE, NULL),
  ('Iso', 'Grifo', 1965, 'Italia', FALSE, NULL),
  ('Abarth', '595', 2008, 'Italia', FALSE, NULL),

  -- Japón (35)
  ('Toyota', 'Supra Mk4', 1993, 'Japón', FALSE, NULL),
  ('Toyota', 'GR Supra', 2019, 'Japón', FALSE, NULL),
  ('Toyota', 'Celica GT', 1970, 'Japón', FALSE, NULL),
  ('Toyota', '2000GT', 1967, 'Japón', FALSE, NULL),
  ('Toyota', 'Hilux', 1968, 'Japón', FALSE, NULL),
  ('Toyota', 'GT86', 2012, 'Japón', FALSE, NULL),
  ('Toyota', 'Corolla AE86', 1983, 'Japón', FALSE, NULL),
  ('Honda', 'Civic Type R EK9', 1997, 'Japón', FALSE, NULL),
  ('Honda', 'Civic Type R FK8', 2017, 'Japón', FALSE, NULL),
  ('Honda', 'Integra Type R DC2', 1995, 'Japón', FALSE, NULL),
  ('Honda', 'Prelude', 1978, 'Japón', FALSE, NULL),
  ('Honda', 'Insight', 1999, 'Japón', FALSE, NULL),
  ('Nissan', 'Skyline GT-R R32', 1989, 'Japón', FALSE, NULL),
  ('Nissan', 'Sunny GTI-R', 1990, 'Japón', FALSE, NULL),
  ('Nissan', '200SX', 1988, 'Japón', FALSE, NULL),
  ('Nissan', 'Pulsar GTI-R', 1990, 'Japón', FALSE, NULL),
  ('Nissan', 'Patrol', 1980, 'Japón', FALSE, NULL),
  ('Nissan', 'Fairlady Z', 1969, 'Japón', FALSE, NULL),
  ('Mazda', '323 GTX', 1986, 'Japón', FALSE, NULL),
  ('Mazda', 'Cosmo', 1967, 'Japón', FALSE, NULL),
  ('Mazda', '787B', 1991, 'Japón', FALSE, NULL),
  ('Mitsubishi', 'Pajero', 1982, 'Japón', FALSE, NULL),
  ('Mitsubishi', 'Eclipse', 1989, 'Japón', FALSE, NULL),
  ('Mitsubishi', 'Lancer Evolution III', 1995, 'Japón', FALSE, NULL),
  ('Subaru', 'Forester STi', 2003, 'Japón', FALSE, NULL),
  ('Subaru', 'Legacy', 1989, 'Japón', FALSE, NULL),
  ('Subaru', 'Vivio', 1992, 'Japón', FALSE, NULL),
  ('Suzuki', 'Jimny', 1970, 'Japón', FALSE, NULL),
  ('Suzuki', 'Vitara', 1988, 'Japón', FALSE, NULL),
  ('Lexus', 'LC500', 2016, 'Japón', FALSE, NULL),
  ('Lexus', 'RC F', 2014, 'Japón', FALSE, NULL),
  ('Daihatsu', 'Charade GTti', 1987, 'Japón', FALSE, NULL),
  ('Datsun', '240Z', 1969, 'Japón', FALSE, NULL),
  ('Infiniti', 'G37', 2007, 'Japón', FALSE, NULL),
  ('Mazda', 'RX-3', 1971, 'Japón', FALSE, NULL),

  -- EE.UU. (25)
  ('Ford', 'Mustang GT', 2015, 'EE.UU.', FALSE, NULL),
  ('Ford', 'GT', 2005, 'EE.UU.', FALSE, NULL),
  ('Ford', 'Thunderbird', 1955, 'EE.UU.', FALSE, NULL),
  ('Ford', 'Escort RS2000', 1975, 'EE.UU.', FALSE, NULL),
  ('Chevrolet', 'Corvette ZR1', 1990, 'EE.UU.', FALSE, NULL),
  ('Chevrolet', 'Bel Air', 1957, 'EE.UU.', FALSE, NULL),
  ('Chevrolet', 'Impala SS', 1994, 'EE.UU.', FALSE, NULL),
  ('Chevrolet', 'Corvette Stingray C8', 2019, 'EE.UU.', FALSE, NULL),
  ('Dodge', 'Demon', 2018, 'EE.UU.', FALSE, NULL),
  ('Dodge', 'Challenger T/A', 1970, 'EE.UU.', FALSE, NULL),
  ('Dodge', 'Stealth', 1990, 'EE.UU.', FALSE, NULL),
  ('Pontiac', 'Solstice', 2005, 'EE.UU.', FALSE, NULL),
  ('Pontiac', 'Fiero', 1983, 'EE.UU.', FALSE, NULL),
  ('Cadillac', 'CTS-V', 2003, 'EE.UU.', FALSE, NULL),
  ('Cadillac', 'Escalade', 1998, 'EE.UU.', FALSE, NULL),
  ('Jeep', 'Grand Cherokee SRT', 2011, 'EE.UU.', FALSE, NULL),
  ('Jeep', 'Cherokee XJ', 1984, 'EE.UU.', FALSE, NULL),
  ('AMC', 'Pacer', 1975, 'EE.UU.', FALSE, NULL),
  ('Buick', 'Riviera', 1963, 'EE.UU.', FALSE, NULL),
  ('Oldsmobile', '442', 1968, 'EE.UU.', FALSE, NULL),
  ('Tesla', 'Model X', 2015, 'EE.UU.', FALSE, NULL),
  ('Tesla', 'Cybertruck', 2023, 'EE.UU.', FALSE, NULL),
  ('Lincoln', 'Continental', 1961, 'EE.UU.', FALSE, NULL),
  ('Saturn', 'Sky', 2006, 'EE.UU.', FALSE, NULL),
  ('Plymouth', 'Road Runner', 1968, 'EE.UU.', FALSE, NULL),

  -- Reino Unido (25)
  ('Aston Martin', 'DB9', 2003, 'Reino Unido', FALSE, NULL),
  ('Aston Martin', 'Vanquish', 2001, 'Reino Unido', FALSE, NULL),
  ('Mclaren', 'Senna', 2018, 'Reino Unido', FALSE, NULL),
  ('Mclaren', 'Speedtail', 2019, 'Reino Unido', FALSE, NULL),
  ('Jaguar', 'XJS', 1975, 'Reino Unido', FALSE, NULL),
  ('Jaguar', 'F-Type', 2012, 'Reino Unido', FALSE, NULL),
  ('Jaguar', 'Mark 2', 1959, 'Reino Unido', FALSE, NULL),
  ('Jaguar', 'XJR', 1994, 'Reino Unido', FALSE, NULL),
  ('Lotus', 'Exige', 2000, 'Reino Unido', FALSE, NULL),
  ('Lotus', 'Evora', 2008, 'Reino Unido', FALSE, NULL),
  ('Tvr', 'Cerbera', 1996, 'Reino Unido', FALSE, NULL),
  ('Tvr', 'Tuscan', 1999, 'Reino Unido', FALSE, NULL),
  ('Bentley', 'Arnage', 1998, 'Reino Unido', FALSE, NULL),
  ('Bentley', 'Mulsanne', 2010, 'Reino Unido', FALSE, NULL),
  ('Mini', 'John Cooper Works GP', 2020, 'Reino Unido', FALSE, NULL),
  ('Land Rover', 'Discovery', 1989, 'Reino Unido', FALSE, NULL),
  ('Land Rover', 'Range Rover Sport SVR', 2014, 'Reino Unido', FALSE, NULL),
  ('Morgan', '3 Wheeler', 2011, 'Reino Unido', FALSE, NULL),
  ('Reliant', 'Scimitar', 1968, 'Reino Unido', FALSE, NULL),
  ('Sunbeam', 'Tiger', 1964, 'Reino Unido', FALSE, NULL),
  ('Ginetta', 'G40', 2010, 'Reino Unido', FALSE, NULL),
  ('Vauxhall', 'Astra GTE', 1984, 'Reino Unido', FALSE, NULL),
  ('Bristol', 'Blenheim', 1993, 'Reino Unido', FALSE, NULL),
  ('Marcos', 'Mantis', 1971, 'Reino Unido', FALSE, NULL),
  ('Rover', 'SD1', 1976, 'Reino Unido', FALSE, NULL),

  -- Francia (18)
  ('Peugeot', '504', 1968, 'Francia', FALSE, NULL),
  ('Peugeot', 'RCZ R', 2013, 'Francia', FALSE, NULL),
  ('Peugeot', '308 GTi', 2015, 'Francia', FALSE, NULL),
  ('Peugeot', '405 T16', 1992, 'Francia', FALSE, NULL),
  ('Renault', 'Mégane RS', 2014, 'Francia', FALSE, NULL),
  ('Renault', 'Avantime', 2001, 'Francia', FALSE, NULL),
  ('Renault', 'Espace', 1984, 'Francia', FALSE, NULL),
  ('Renault', 'Twingo', 1992, 'Francia', FALSE, NULL),
  ('Renault', 'Alpine A310', 1971, 'Francia', FALSE, NULL),
  ('Citroen', '2CV', 1948, 'Francia', FALSE, NULL),
  ('Citroen', 'BX GTi', 1986, 'Francia', FALSE, NULL),
  ('Citroen', 'Xantia Activa', 1994, 'Francia', FALSE, NULL),
  ('Citroen', 'SM', 1970, 'Francia', FALSE, NULL),
  ('Citroen', 'CX', 1974, 'Francia', FALSE, NULL),
  ('Alpine', 'A610', 1991, 'Francia', FALSE, NULL),
  ('Alpine', 'A110 Nueva', 2017, 'Francia', FALSE, NULL),
  ('Venturi', '400 GT', 1994, 'Francia', FALSE, NULL),
  ('Matra', 'Murena', 1980, 'Francia', FALSE, NULL),

  -- España (8)
  ('Seat', '600', 1957, 'España', FALSE, NULL),
  ('Seat', '124', 1968, 'España', FALSE, NULL),
  ('Seat', 'León Cupra', 2014, 'España', FALSE, NULL),
  ('Seat', 'Ateca Cupra', 2018, 'España', FALSE, NULL),
  ('Cupra', 'Formentor', 2020, 'España', FALSE, NULL),
  ('Hispano-Suiza', 'Carmen', 2019, 'España', FALSE, NULL),
  ('Pegaso', 'Z-102', 1951, 'España', FALSE, NULL),
  ('GTA', 'Spano', 2010, 'España', FALSE, NULL),

  -- Corea del Sur (5)
  ('Kia', 'Stinger GT', 2017, 'Corea del Sur', FALSE, NULL),
  ('Kia', 'EV6 GT', 2022, 'Corea del Sur', FALSE, NULL),
  ('Genesis', 'G70', 2017, 'Corea del Sur', FALSE, NULL),
  ('Hyundai', 'Pony', 1975, 'Corea del Sur', FALSE, NULL),
  ('Hyundai', 'Ioniq 5 N', 2024, 'Corea del Sur', FALSE, NULL),

  -- Suecia (4)
  ('Volvo', '240', 1974, 'Suecia', FALSE, NULL),
  ('Volvo', 'P1800', 1961, 'Suecia', FALSE, NULL),
  ('Saab', 'Sonett', 1966, 'Suecia', FALSE, NULL),
  ('Koenigsegg', 'Jesko', 2019, 'Suecia', FALSE, NULL),

  -- Otros (5)
  ('Tatra', 'T87', 1937, 'República Checa', FALSE, NULL),
  ('Skoda', 'Felicia', 1959, 'República Checa', FALSE, NULL),
  ('Dacia', '1300', 1969, 'Rumanía', FALSE, NULL),
  ('GAZ', 'Volga 21', 1956, 'Rusia', FALSE, NULL),
  ('DAF', '33', 1967, 'Países Bajos', FALSE, NULL);


-- =============================================================================
-- [PASO 4] Re-randomizar futuros más allá de la ventana visible (hoy+6)
-- =============================================================================
-- Mantiene intactos los próximos 7 coches (hoy + 6 siguientes = ventana
-- del SchedulePanel) y libera todo lo posterior. La próxima vez que
-- pick_daily_car se llame para esas fechas, hará random sobre el pool
-- actualizado — incluyendo los nuevos coches a medida que les vayas
-- subiendo imagen.

DELETE FROM public.daily_cars
WHERE date > ((now() AT TIME ZONE 'Europe/Madrid')::date + 6);


-- =============================================================================
-- [VERIFICACIÓN] Cuenta los pendientes de imagen — debería dar 200
-- =============================================================================
SELECT COUNT(*) AS pendientes_imagen
FROM public.cars
WHERE image_ready = FALSE;
