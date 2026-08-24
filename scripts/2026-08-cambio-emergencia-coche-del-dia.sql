-- scripts/2026-08-cambio-emergencia-coche-del-dia.sql
-- Cambio de emergencia del coche del día: el día pasa a tener REVISIONES.
--
-- Qué problema resuelve: sale un coche que no tocaba y hay que sustituirlo con
-- la jornada ya empezada. Cambiar `daily_cars.car_id` a secas le da a cada
-- usuario logueado un tablero a cero y cinco intentos nuevos, porque
-- `user_guesses` está clavada por (user_id, car_id, date): el día se podría
-- rejugar. Con revisiones, quien ya jugó se queda con SU coche hasta
-- medianoche y quien no ha empezado ve el nuevo.
--
-- Idempotente: se puede ejecutar dos veces sin daño.
-- Regla 20: aquí solo hay esquema y funciones. Ni un solo car_id.

-- ===========================================================================
-- [1] La columna: qué coches han sido el de hoy antes que el actual
-- ===========================================================================
-- Un array y no una tabla aparte porque el dato es por fecha, se resetea solo
-- al cambiar el día y nunca tendrá más de un puñado de elementos. `daily_cars`
-- está revocada para anon/authenticated por el hardening, así que no hace falta
-- GRANT (y no debe llevarlo: dice de qué coches va el día).
ALTER TABLE public.daily_cars
  ADD COLUMN IF NOT EXISTS prev_car_ids uuid[] NOT NULL DEFAULT '{}';

-- ===========================================================================
-- [2] coche_de_hoy(): el coche vigente Y los salientes, en un solo viaje
-- ===========================================================================
-- Por qué existe: el resolvedor del servidor necesita `prev_car_ids` para
-- acotar el ancla del usuario, y leerlos con una segunda consulta añadiría un
-- round-trip al ÚNICO request bloqueante del primer paint.
--
-- No toca el sorteo: delega en pick_daily_car, que es donde vive la temática de
-- la temporada. Es una envoltura, y a propósito — cualquier camino que elija
-- coche sin pasar por la RPC se salta el tema en silencio.
CREATE OR REPLACE FUNCTION public.coche_de_hoy(p_date date)
RETURNS TABLE (car_id uuid, prev_car_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Idempotente: fija el coche de la fecha si aún no lo estaba y lo devuelve.
  PERFORM public.pick_daily_car(p_date);

  RETURN QUERY
  SELECT d.car_id, COALESCE(d.prev_car_ids, '{}'::uuid[])
  FROM public.daily_cars d
  WHERE d.date = p_date;
END;
$$;

-- Solo el servidor la llama, y siempre con service_role.
REVOKE ALL ON FUNCTION public.coche_de_hoy(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coche_de_hoy(date) TO service_role;

-- ===========================================================================
-- [3] Parche de record_daily_result_v2
-- ===========================================================================
-- SIN ESTO, EL RESTO DE LA FUNCIONALIDAD HACE DAÑO. La función se re-deriva el
-- coche del día con pick_daily_car y luego busca la partida por ese car_id. Un
-- jugador congelado tiene su fila con el car_id VIEJO, así que:
--   · `v_guesses is null` → raise 'No game state for today' → gana y no se le
--     registra ni puntos ni racha;
--   · y dentro del `if p_won`, la ficha real se lee por v_car, así que su
--     intento ganador tampoco casaría ('Winning guess does not match real car').
--
-- El parche resuelve v_car UNA vez al principio y el resto del cuerpo sigue
-- igual sin enterarse. No abre ningún agujero: v_prev solo contiene coches que
-- REALMENTE fueron el coche del día, así que un coche de repesca (misma tabla,
-- misma fecha, otro car_id) no puede colarse por ahí a robar puntos y racha.
CREATE OR REPLACE FUNCTION public.record_daily_result_v2(p_won boolean, p_attempt_number integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user            uuid := auth.uid();
  v_today           date := (now() at time zone 'Europe/Madrid')::date;
  v_car             uuid;
  v_prev            uuid[];
  v_car_congelado   uuid;
  v_guesses         jsonb;
  v_status          text;
  v_real_attempts   int;
  v_expected_status text;
  v_make            text;
  v_model           text;
  v_year            int;
  v_last_guess      jsonb;
  v_g_marca         text;
  v_g_modelo        text;
  v_g_anio          int;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  v_car := public.pick_daily_car(v_today);
  if v_car is null then
    raise exception 'No daily car for today';
  end if;

  -- ---- Revisiones del día (cambio de emergencia) -------------------------
  -- Si el usuario tiene fila en una revisión ANTERIOR de hoy, esa es su
  -- partida: la jugó contra ese coche y contra ese coche hay que verificarla.
  -- En un día normal prev_car_ids está vacío y esto no hace absolutamente nada.
  select coalesce(prev_car_ids, '{}'::uuid[]) into v_prev
  from public.daily_cars
  where date = v_today;

  if array_length(v_prev, 1) is not null then
    select car_id into v_car_congelado
    from public.user_guesses
    where user_id = v_user
      and date    = v_today
      and car_id  = any(v_prev)
    limit 1;

    if v_car_congelado is not null then
      v_car := v_car_congelado;
    end if;
  end if;
  -- ------------------------------------------------------------------------

  -- user_guesses.date es DATE → comparación directa, sin cast.
  select guesses, status
    into v_guesses, v_status
  from user_guesses
  where user_id = v_user
    and car_id  = v_car
    and date    = v_today;

  if v_guesses is null then
    raise exception 'No game state for today';
  end if;

  v_real_attempts := jsonb_array_length(v_guesses);
  v_expected_status := case when p_won then 'won' else 'lost' end;

  if v_status <> v_expected_status then
    raise exception 'Won mismatch (client=%, server=%)', p_won, v_status;
  end if;
  if v_real_attempts <> p_attempt_number then
    raise exception 'Attempt mismatch (client=%, server=%)',
      p_attempt_number, v_real_attempts;
  end if;

  if p_won then
    select make, model, year
      into v_make, v_model, v_year
    from cars
    where id = v_car;

    v_last_guess := v_guesses -> (v_real_attempts - 1);
    v_g_marca  := lower(trim(coalesce(v_last_guess->'marca'->>'val', '')));
    v_g_modelo := lower(trim(coalesce(v_last_guess->'modelo'->>'val', '')));
    v_g_anio   := nullif(v_last_guess->'anio'->>'val', '')::int;

    if v_g_marca  <> lower(v_make)
       or v_g_modelo <> lower(v_model)
       or v_g_anio is null
       or abs(v_g_anio - v_year) > 2
    then
      raise exception 'Winning guess does not match real car';
    end if;
  end if;

  return public.record_daily_result(p_won, p_attempt_number);
end;
$function$;

-- ===========================================================================
-- [4] Verificación (ejecutar después; devuelve filas, no cambia nada)
-- ===========================================================================
-- La columna existe y es NOT NULL con default:
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'daily_cars'
ORDER BY ordinal_position;

-- La envoltura devuelve el mismo coche que el sorteo, y el array vacío:
SELECT * FROM public.coche_de_hoy((now() AT TIME ZONE 'Europe/Madrid')::date);

-- El parche está dentro (debe aparecer 'v_car_congelado'):
SELECT position('v_car_congelado' in pg_get_functiondef(p.oid)) > 0 AS parche_aplicado
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'record_daily_result_v2';
