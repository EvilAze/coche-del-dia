-- scripts/2026-08-nick-validado-en-servidor.sql
-- EL NICK PASA A VALIDARSE EN LA BASE DE DATOS, NO EN EL NAVEGADOR.
--
-- Aplicar en el SQL editor de Supabase. Idempotente (IF NOT EXISTS / DO block).
--
-- ---------------------------------------------------------------------------
-- QUÉ ESTABA ROTO
-- ---------------------------------------------------------------------------
-- `profiles.display_name` es la ÚNICA cadena escrita por un usuario que ve el
-- resto de usuarios: sale en la clasificación, en el podio, en el salón de
-- campeones y en el perfil público. O sea, es contenido generado por el
-- usuario en el sentido literal.
--
-- Y hasta hoy su única regla —12 caracteres alfanuméricos— vivía en DOS
-- ficheros que corren en el ordenador del jugador: src/lib/statsService.js y
-- src/components/NicknameModal.jsx. El guardado es un `upsert` directo a
-- PostgREST con la anon key, así que la regla se saltaba escribiendo la
-- petición a mano:
--
--   PATCH /rest/v1/profiles?id=eq.<mi-uuid>
--   Authorization: Bearer <mi propio JWT, el de mi sesión legítima>
--   {"display_name": "<300 caracteres de lo que sea>"}
--
-- Las policies que ya existen NO lo tapan. `profiles own update` comprueba
-- identidad (`id = auth.uid()`), que es otra pregunta; y las restrictivas de
-- 2026-07-rls-anonimos-fuera-de-la-tabla.sql solo dicen «un anónimo no puede
-- tener nick». Ninguna mira el CONTENIDO. Nadie lo miraba.
--
-- Es el mismo razonamiento de la regla 4 del CLAUDE.md, aplicado a un campo de
-- texto: si la defensa se puede quitar abriendo las DevTools, no es una
-- defensa. El sitio de la regla es la tabla.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ UN CHECK Y NO UN ENDPOINT
-- ---------------------------------------------------------------------------
-- La alternativa era mover el guardado a /api/... y validar allí. Sería peor:
-- deja la tabla igual de abierta (el upsert directo sigue existiendo mientras
-- exista la policy de UPDATE), gasta una de las 12 funciones del plan Hobby, y
-- añade un salto de red a un flujo que hoy es instantáneo. Un CHECK no se
-- puede rodear: no hay camino a la columna que no pase por él.
--
-- El cliente conserva su validación —el mensaje de error inmediato es lo que
-- hace usable el modal—, pero deja de ser la autoridad: ahora es una cortesía
-- por delante de la regla real. Las dos réplicas se mantienen sincronizadas
-- por src/lib/nickname.sync.test.js, que lee ESTE fichero y compara el patrón.
-- Si tocas el regex de aquí y no el de src/lib/nickname.js, el build cae.

-- ============================================================================
-- [1] El formato: 1-12 alfanuméricos ASCII, o NULL
-- ============================================================================
-- NULL sigue siendo válido y significa «sin firma»: es el estado de todo
-- anónimo y el de un registrado que aún no ha elegido nick. Las funciones de
-- clasificación ya lo descartan solas (`WHERE display_name IS NOT NULL`), así
-- que un perfil sin nick simplemente no sale en la tabla.
--
-- NOT VALID a propósito: aplica a TODA escritura futura desde este mismo
-- instante —que es lo que cierra el agujero— pero no aborta la migración si
-- alguna fila histórica no cumple. El bloque [1b] te dice si hay alguna.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_display_name_formato'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_display_name_formato
      CHECK (display_name IS NULL OR display_name ~ '^[A-Za-z0-9]{1,12}$')
      NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- [1b] ¿Hay filas históricas que no cumplen?
-- ---------------------------------------------------------------------------
-- Solo el RECUENTO, nunca los valores: este fichero se versiona en un
-- repositorio público (regla 20). Los nicks en sí no comprometen la
-- hermeticidad del coche del día, pero tampoco hay motivo para publicarlos.
DO $$
DECLARE
  v_malas int;
BEGIN
  SELECT count(*) INTO v_malas
  FROM public.profiles
  WHERE display_name IS NOT NULL
    AND display_name !~ '^[A-Za-z0-9]{1,12}$';

  IF v_malas = 0 THEN
    RAISE NOTICE 'Nicks fuera de formato: 0. Puedes validar el CHECK (ver [1c]).';
  ELSE
    RAISE NOTICE 'Nicks fuera de formato: %. El CHECK ya bloquea escrituras nuevas;', v_malas;
    RAISE NOTICE 'limpia esas filas y luego valida el CHECK con el bloque [1c].';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- [1c] Promover el CHECK a validado (DESPUÉS de que [1b] diga 0)
-- ---------------------------------------------------------------------------
-- Descomentar y ejecutar cuando el recuento de arriba sea 0. Mientras tanto el
-- constraint ya protege el futuro, que es lo urgente; validarlo solo añade la
-- garantía de que el pasado también cumple.
--
-- ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_display_name_formato;

-- ============================================================================
-- [2] Nicks retirados: que «retirar» signifique algo
-- ============================================================================
-- El formato no dice nada sobre el CONTENIDO, y no puede: «BASURA» y «AZUL»
-- son igual de alfanuméricos. Cuando haya que retirar un nick ofensivo, el
-- panel lo pone a NULL — pero sin esta tabla el jugador vuelve a escribirlo en
-- diez segundos y el botón del panel sería teatro.
--
-- Una lista de retirados y no un diccionario de palabrotas: un diccionario es
-- imposible de acertar en dos idiomas, produce falsos positivos ofensivos por
-- su cuenta («Escocia» contiene «coci»…) y, en un repositorio público, sería
-- además el mapa para rodearlo. Esta lista nace vacía y solo crece con lo que
-- de verdad haya pasado.
CREATE TABLE IF NOT EXISTS public.nicks_retirados (
  -- En minúsculas: se retira el NOMBRE, no una capitalización concreta. Si no,
  -- retirar «PEPE» deja libre «Pepe» y no hemos hecho nada.
  nick_lower  text PRIMARY KEY,
  retirado_en timestamptz NOT NULL DEFAULT now(),
  -- Nota interna del admin. Nunca se le enseña al jugador: el modal solo dice
  -- «elige otro», igual que con un nick ya cogido.
  motivo      text
);

COMMENT ON TABLE public.nicks_retirados IS
  'Nicks retirados por moderación. No se pueden volver a tomar. Deny-all: solo service_role.';

-- Deny-all, mismo patrón que push_subscriptions y tunel_games: esta lista no
-- la lee el cliente. Publicarla sería publicar el registro de moderación —y,
-- de paso, la lista exacta de lo que alguien escribió alguna vez.
ALTER TABLE public.nicks_retirados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nicks_retirados FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- [2b] El trigger que la hace cumplir
-- ---------------------------------------------------------------------------
-- Un CHECK no sirve aquí: no puede consultar otra tabla. Tiene que ser un
-- trigger.
--
-- SECURITY DEFINER porque el rol `authenticated` no tiene —ni debe tener—
-- SELECT sobre nicks_retirados; sin esto, el trigger fallaría al leerla y
-- rompería el guardado de CUALQUIER nick. `search_path` fijado por la misma
-- razón que en pick_daily_car: una función SECURITY DEFINER con search_path
-- mutable es un vector de hijacking (ver 2026-06-lockdown-securitydefiner-
-- grants.sql).
CREATE OR REPLACE FUNCTION public.nick_no_retirado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if new.display_name is not null
     and exists (
       select 1 from public.nicks_retirados
       where nick_lower = lower(new.display_name)
     )
  then
    -- 23505 (unique_violation) A PROPÓSITO, y no un código propio: es
    -- exactamente el error que ya produce un nick cogido, y statsService.js ya
    -- lo traduce a «Este nombre ya está en uso. Elige otro.». Así el jugador
    -- recibe el mensaje que ya existe en los dos idiomas, y —más importante—
    -- un nick retirado es indistinguible de uno ocupado: nadie puede sondear
    -- la lista de moderación probando nombres.
    raise exception 'display_name no disponible' using errcode = '23505';
  end if;
  return new;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.nick_no_retirado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_nick_no_retirado ON public.profiles;
CREATE TRIGGER profiles_nick_no_retirado
  BEFORE INSERT OR UPDATE OF display_name ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.nick_no_retirado();

-- ============================================================================
-- [3] Verificación
-- ============================================================================
-- Recuentos y metadatos del esquema. Nada que acote el sorteo del día, así que
-- se queda en el fichero público y el script es ejecutable de principio a fin.

-- El CHECK existe, y si está validado o no.
SELECT conname, convalidated
FROM pg_constraint
WHERE conrelid = 'public.profiles'::regclass
  AND conname = 'profiles_display_name_formato';

-- El trigger está armado.
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'public.profiles'::regclass
  AND tgname = 'profiles_nick_no_retirado';

-- Cuántos nicks hay, y cuántos incumplen (debería ser 0 tras la limpieza).
SELECT
  count(*) FILTER (WHERE display_name IS NOT NULL)                             AS con_nick,
  count(*) FILTER (WHERE display_name IS NOT NULL
                     AND display_name !~ '^[A-Za-z0-9]{1,12}$')                AS fuera_de_formato
FROM public.profiles;

-- Cuántos retirados llevamos.
SELECT count(*) AS nicks_retirados FROM public.nicks_retirados;
