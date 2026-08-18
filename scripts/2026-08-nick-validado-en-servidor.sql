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
-- [3] «Max» y «max» dejan de poder coexistir
-- ============================================================================
-- El índice UNIQUE que ya tenía la columna es sensible a mayúsculas, así que
-- suplantar a alguien de la clasificación costaba cambiar una letra de caja: el
-- podio enseñaba «MAX» y «Max» uno encima del otro y no hay forma humana de
-- saber cuál es cuál. Un nombre que se distingue del de otro solo por la caja
-- no es un nombre distinto, es el mismo nombre escrito de otra manera.
--
-- Es además lo que hace honesta la lista de retirados de [2], que normaliza a
-- minúsculas: sin esto, retirar «PEPE» dejaba libre «Pepe» y la moderación se
-- rodeaba con la tecla de bloq. mayús.
--
-- NADA MÁS EN EL PROYECTO CAMBIA. Se comprobó antes de escribir esto: ninguna
-- consulta busca perfiles por nombre —get_public_profile, las funciones de
-- temporada y el salón de campeones filtran todas por `user_id`—, así que el
-- nick solo se compara consigo mismo aquí. El cliente tampoco necesita cambio:
-- una colisión llega como 23505 y statsService.js ya la traduce a «Este nombre
-- ya está en uso. Elige otro.», igual que una colisión exacta.

-- ---------------------------------------------------------------------------
-- [3a] ¿Hay colisiones ya en producción?
-- ---------------------------------------------------------------------------
-- ESTA CONSULTA SÍ IMPRIME NICKS, y es deliberado: para resolver un choque hay
-- que saber QUIÉNES chocan. Lo que la regla 20 prohíbe es incrustar datos en el
-- fichero versionado; el resultado de ejecutarla vive en tu pantalla, no en el
-- repositorio. (Y un nick no acota el sorteo del día: no es de esa familia.)
--
-- Si devuelve filas, resuélvelas ANTES de [3b] — el índice no se puede crear
-- con duplicados. Ahora hay botón para eso: panel → Analítica → click en el
-- usuario → «Retirar nick».
SELECT
  lower(display_name) AS nick_normalizado,
  count(*)            AS cuantos,
  array_agg(display_name ORDER BY display_name) AS variantes,
  array_agg(id ORDER BY display_name)           AS perfiles
FROM public.profiles
WHERE display_name IS NOT NULL
GROUP BY lower(display_name)
HAVING count(*) > 1;

-- ---------------------------------------------------------------------------
-- [3b] El índice
-- ---------------------------------------------------------------------------
-- Sin CONCURRENTLY a propósito: `profiles` tiene decenas de filas, el índice se
-- construye en milisegundos, y CONCURRENTLY no puede correr dentro de un bloque
-- de transacción (que es como el SQL editor ejecuta esto). El bloqueo de tabla
-- que toma la versión normal dura menos que el viaje de red que lo pide.
--
-- El DO block hace dos cosas, y la segunda importa más de lo que parece.
--
-- La obvia: un `CREATE UNIQUE INDEX` sobre datos con duplicados muere con «could
-- not create unique index ... Key (lower(display_name))=(pepe) is duplicated»,
-- que dice qué pasó pero no qué hacer.
--
-- LA QUE DE VERDAD IMPORTA: si hay colisiones, esto AVISA Y SIGUE en vez de
-- reventar. El SQL editor de Supabase ejecuta el script entero en UNA
-- transacción, así que un `RAISE EXCEPTION` aquí abortaría también el CHECK de
-- [1] y la tabla de [2] — o sea, un choque de mayúsculas entre dos jugadores
-- dejaría sin aplicar la parte urgente, que es la que cierra el agujero. Es el
-- mismo criterio que el NOT VALID de [1]: aplicar todo lo que se pueda aplicar
-- y decir en voz alta lo que queda pendiente.
DO $$
DECLARE
  v_choques int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'profiles_display_name_lower_key' AND relkind = 'i'
  ) THEN
    RAISE NOTICE '[3b] El índice ya existe. Nada que hacer.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_choques FROM (
    SELECT 1 FROM public.profiles
    WHERE display_name IS NOT NULL
    GROUP BY lower(display_name)
    HAVING count(*) > 1
  ) t;

  IF v_choques > 0 THEN
    RAISE NOTICE '[3b] PENDIENTE: % nombre(s) repetidos ignorando mayúsculas.', v_choques;
    RAISE NOTICE '[3b] El resto del script SÍ se ha aplicado. Para terminar:';
    RAISE NOTICE '[3b]   1. ejecuta la consulta [3a] sola, para ver cuáles son;';
    RAISE NOTICE '[3b]   2. retira uno de cada par en el panel (Analítica → usuario → Retirar nick);';
    RAISE NOTICE '[3b]   3. vuelve a ejecutar este fichero (es idempotente).';
    RETURN;
  END IF;

  -- NULL no colisiona con NULL en un índice único de Postgres, así que los
  -- perfiles sin firma (todos los anónimos, y los registrados que aún no han
  -- elegido) conviven sin problema por muchos que sean.
  CREATE UNIQUE INDEX profiles_display_name_lower_key
    ON public.profiles (lower(display_name));

  RAISE NOTICE '[3b] Índice creado: los nicks ya no se distinguen por la caja.';
END $$;

-- ---------------------------------------------------------------------------
-- [3c] El UNIQUE viejo queda redundante
-- ---------------------------------------------------------------------------
-- El índice de [3b] es más fuerte: si no puede haber dos «pepe» ignorando la
-- caja, tampoco puede haber dos «pepe» idénticos. El UNIQUE original sobre la
-- columna cruda ya no aporta nada y solo cuesta una escritura de índice por
-- guardado.
--
-- NO se borra aquí porque `profiles` se creó antes de que existiera esta
-- carpeta de migraciones y su constraint no tiene un nombre que se pueda dar
-- por supuesto. Esta consulta te dice cómo se llama; borrarlo es opcional y sin
-- prisa (a esta escala el coste es indistinguible de cero).
SELECT conname AS unique_viejo_a_borrar
FROM pg_constraint
WHERE conrelid = 'public.profiles'::regclass
  AND contype = 'u'
  AND pg_get_constraintdef(oid) ILIKE '%(display_name)%';
-- ALTER TABLE public.profiles DROP CONSTRAINT <el nombre que salga arriba>;

-- ============================================================================
-- [4] Verificación
-- ============================================================================
-- Recuentos y metadatos del esquema. Nada que acote el sorteo del día, así que
-- se queda en el fichero público y el script es ejecutable de principio a fin.
--
-- UNA SOLA CONSULTA, y no cuatro: el SQL editor de Supabase enseña el resultado
-- de la ÚLTIMA sentencia, así que cuatro SELECT seguidos son tres que nadie ve.
-- Todo cabe en una tabla de dos columnas que se lee de un vistazo.
--
-- Lectura esperada con el script aplicado del todo: las tres primeras filas en
-- «puesto», y ceros en «fuera de formato» y «chocan solo por la caja».
SELECT comprobacion, estado FROM (
  SELECT 1 AS orden, 'CHECK de formato' AS comprobacion,
    coalesce(
      (SELECT CASE WHEN convalidated
                THEN 'puesto y validado'
                ELSE 'puesto (falta validar: ver [1c])' END
       FROM pg_constraint
       WHERE conrelid = 'public.profiles'::regclass
         AND conname = 'profiles_display_name_formato'),
      'FALTA') AS estado

  UNION ALL SELECT 2, 'Trigger de nicks retirados',
    coalesce(
      (SELECT CASE WHEN tgenabled = 'O' THEN 'armado' ELSE 'deshabilitado' END
       FROM pg_trigger
       WHERE tgrelid = 'public.profiles'::regclass
         AND tgname = 'profiles_nick_no_retirado'),
      'FALTA')

  UNION ALL SELECT 3, 'Indice unico ignorando la caja',
    coalesce(
      (SELECT 'puesto' FROM pg_class
       WHERE relname = 'profiles_display_name_lower_key' AND relkind = 'i'),
      'FALTA (ver [3b])')

  UNION ALL SELECT 4, 'Nicks fuera de formato',
    (SELECT count(*)::text FROM public.profiles
     WHERE display_name IS NOT NULL
       AND display_name !~ '^[A-Za-z0-9]{1,12}$')

  UNION ALL SELECT 5, 'Nicks que chocan solo por la caja',
    (SELECT count(*)::text FROM (
       SELECT 1 FROM public.profiles
       WHERE display_name IS NOT NULL
       GROUP BY lower(display_name)
       HAVING count(*) > 1) t)

  UNION ALL SELECT 6, 'Nicks retirados hasta hoy',
    (SELECT count(*)::text FROM public.nicks_retirados)
) v
ORDER BY orden;
