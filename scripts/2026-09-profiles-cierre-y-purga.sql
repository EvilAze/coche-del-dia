-- 2026-09-profiles-cierre-y-purga.sql
-- CIERRA la lectura pública de public.profiles y ELIMINA de ella el nombre real
-- y la foto de Google de los jugadores, que se recogían sin usarse y estaban
-- accesibles para cualquiera con la anon key.
--
-- ============================================================================
-- QUÉ PASABA
-- ============================================================================
-- `select * from profiles` con la anon key devolvía, de toda cuenta no marcada:
-- id, username, avatar_url, updated_at, display_name e is_flagged.
--
-- Y `username` NO es el nick del juego. Lo escribe el trigger
-- on_auth_user_created → public.handle_new_user(), que es el de la plantilla de
-- inicio de Supabase y hace literalmente:
--
--     insert into public.profiles (id, username, avatar_url)
--     values (new.id,
--             coalesce(new.raw_user_meta_data->>'full_name', …),
--             coalesce(new.raw_user_meta_data->>'avatar_url', …));
--
-- O sea: `username` es el **full_name de la cuenta de Google** —el nombre real
-- de la persona— y `avatar_url` su foto de perfil. 213 de 214 cuentas lo tenían
-- relleno, mientras que solo 65 habían elegido un `display_name`; en 195 casos
-- el nombre real y el nick que la persona sí quiso enseñar NO coinciden.
--
-- El test scripts/test-rls.mjs lo detecta desde MAYO de 2026 y venía fallando
-- todo ese tiempo. Nadie lo ejecutaba.
--
-- ============================================================================
-- POR QUÉ SE ELIMINAN LAS COLUMNAS EN VEZ DE SOLO TAPARLAS
-- ============================================================================
-- Porque no las lee NADA. Se comprobó una por una:
--   · `avatar_url` — cero referencias en src/, api/ y lib/.
--   · `username`   — cero referencias. El campo `username` que sí muestra el
--                    panel interno (Identidad.jsx) NO es esta columna: lo monta
--                    lib/admin-handlers/analytics.js a partir de `display_name`.
--   · Ninguna función de la base las menciona salvo el propio handle_new_user.
--
-- Sin un solo consumidor, guardar el nombre real y la foto de tus jugadores es
-- asumir el riesgo a cambio de nada. Cerrar la puerta deja de servirlos, pero
-- no los borra: seguirían ahí para el próximo fallo de permisos — y hoy mismo
-- ha habido dos.
--
-- ATÓMICO A PROPÓSITO: el trigger se arregla ANTES de tirar las columnas y todo
-- va en una transacción. Si se dropearan primero, cada alta nueva fallaría al
-- insertar en columnas inexistentes durante el hueco entre ambos pasos.
--
-- Ejecutar UNA vez en el SQL Editor de Supabase.

begin;

-- ============================================================================
-- [1] El trigger deja de copiar datos de Google
-- ============================================================================
-- ATRIBUTOS DECLARADOS EXPLÍCITAMENTE, Y COPIADOS DE LOS QUE YA TENÍA:
-- `create or replace function` NO conserva los que no se nombren, así que
-- omitir uno lo pierde. Los de la función viva, consultados antes de tocarla:
--   language plpgsql · security definer · search_path = public, pg_temp
--
-- OJO CON `pg_temp`, QUE NO ES DECORACIÓN: si NO aparece en el search_path,
-- Postgres busca el esquema temporal PRIMERO, de forma implícita. Nombrarlo al
-- final es justamente lo que fuerza a que se busque el último, y es la
-- protección recomendada para una función security definer — sin ella,
-- cualquiera con permiso de crear tablas temporales puede colocar una
-- `profiles` que enmascare a la de verdad y hacer que este insert escriba en
-- la suya. Escribir solo `search_path = public` PARECE más restrictivo y es
-- exactamente lo contrario.
--
-- `on conflict (id) do nothing`: la versión original petaba si la fila ya
-- existía, y un error aquí aborta el ALTA DE LA CUENTA. Que un reintento de
-- registro falle por una fila que ya está es un modo de fallo sin ninguna
-- ventaja.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ============================================================================
-- [2] Fuera el nombre real y la foto
-- ============================================================================
alter table public.profiles drop column if exists username;
alter table public.profiles drop column if exists avatar_url;

-- ============================================================================
-- [3] La política: solo tu propia fila
-- ============================================================================
-- Antes: `id = auth.uid() OR NOT is_flagged` — o sea, el perfil de cualquiera.
-- Tenía sentido cuando la clasificación era una CONSULTA DIRECTA a stats con
-- join a profiles; así lo cuenta, en pasado, el comentario de
-- src/lib/statsService.js:327. Esa consulta se migró a RPC y la puerta se quedó
-- abierta detrás.
--
-- Hoy TODOS los caminos que enseñan un nick ajeno son SECURITY DEFINER y se
-- saltan RLS aplicando su propio filtro de shadowban: get_public_profile,
-- get_legends_leaderboard, get_season_leaderboard, get_champions y
-- get_my_season_rank. El cliente solo toca profiles para SU PROPIA fila
-- (statsService.js:35 y :148) y no hay ni un join embebido de PostgREST contra
-- profiles en todo src/.
--
-- ESTO ENDURECE EL SHADOWBAN, NO LO DEBILITA: antes se escondía la fila de una
-- cuenta marcada; ahora no se ve NINGUNA fila ajena, marcada o no. Donde
-- is_flagged sigue actuando de verdad es dentro de las RPC — lo que montó
-- 2026-08-unificar-shadowban.sql, que aquí no se toca.
--
-- `(select auth.uid())` y no `auth.uid()` a pelo: es la forma que pide el lint
-- de rendimiento de RLS (2026-06-rls-performance-lints.sql), porque así se
-- evalúa una vez como InitPlan en lugar de por fila.
drop policy if exists profiles_select on public.profiles;

create policy profiles_select on public.profiles
  for select
  using (id = (select auth.uid()));

-- ============================================================================
-- [4] GRANT por columna: defensa en profundidad
-- ============================================================================
-- La política ya deja a un anónimo sin filas, así que la fuga la cierra [3].
-- Esto añade dos cosas:
--   a) Que `select *` falle con 42501 en vez de devolver lista vacía. Un
--      permiso denegado es una señal mucho más clara: el vacío se confunde con
--      «no hay datos».
--   b) Que una cuenta marcada no pueda leer su propio `is_flagged`. Con la
--      política vieja podía —`id = auth.uid()` la dejaba pasar— y un shadowban
--      que el shadowbaneado puede consultar deja de ser shadow. Nunca fue
--      intencionado: la columna viajaba de propina en el `select *`.
--
-- El cliente solo necesita id y display_name (src/lib/statsService.js).
revoke select on public.profiles from anon, authenticated;
grant  select (id, display_name) on public.profiles to authenticated;

-- A `anon` no se le devuelve nada: sin JWT no hay auth.uid(), así que su fila
-- propia no existe por definición. Las sesiones anónimas de Supabase NO usan
-- este rol —viajan como `authenticated` con el claim is_anonymous— y por eso
-- las policies profiles_anonimo_sin_firma_* siguen valiendo.
--
-- INSERT y UPDATE no se tocan: el upsert del nick tiene que seguir funcionando,
-- y sus policies (profiles own insert / profiles own update) ya acotan a la
-- fila propia.

commit;

-- ============================================================================
-- COMPROBACIÓN (ejecutar después, ya fuera de la transacción)
-- ============================================================================
-- 1) Las columnas ya no existen. Debe devolver 0 filas.
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in ('username', 'avatar_url');

-- 2) La política quedó en una sola condición, sin el OR.
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT';

-- 3) Los GRANT de SELECT vivos. Solo authenticated, sobre id y display_name.
select grantee, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles'
  and grantee in ('anon', 'authenticated')
  and privilege_type = 'SELECT'
order by grantee, column_name;

-- 4) El trigger conserva sus atributos. Las dos columnas `ok_*` tienen que
--    salir TRUE. Si `ok_search_path` sale false, PARA: se ha perdido el
--    `pg_temp` final y la función quedó menos protegida que antes (ver [1]).
select
  p.prosecdef                                              as es_security_definer,
  p.proconfig                                              as config,
  p.prosecdef                                              as ok_security_definer,
  ('search_path=public, pg_temp' = any(p.proconfig))       as ok_search_path
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname = 'handle_new_user';

-- 5) Las RPC públicas siguen sirviendo nicks: son SECURITY DEFINER y se saltan
--    RLS. Debe devolver filas.
select count(*) as leyendas_visibles from public.get_legends_leaderboard(5);
