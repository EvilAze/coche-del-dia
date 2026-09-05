-- 2026-09-profiles-revertir-policy-y-grants.sql
-- REVIERTE los bloques [3] y [4] de 2026-09-profiles-cierre-y-purga.sql.
-- Los bloques [1] (trigger) y [2] (columnas eliminadas) SE QUEDAN: son el
-- arreglo de verdad y no causaron ningún daño.
--
-- ============================================================================
-- QUÉ ROMPIERON ESOS DOS BLOQUES
-- ============================================================================
-- La política de stats LEE profiles:
--
--     stats_select USING (
--       user_id = (select auth.uid())
--       OR NOT EXISTS (SELECT 1 FROM public.profiles p
--                      WHERE p.id = stats.user_id AND p.is_flagged = true))
--
-- De ahí salen DOS averías, y la segunda es la grave:
--
--   1) ROMPE HACIA FUERA. Las expresiones de RLS se evalúan con los privilegios
--      de quien consulta, así que al revocar SELECT sobre profiles a `anon` Y
--      `authenticated` [bloque 4], esa subconsulta pasó a fallar con 42501 y con
--      ella TODA lectura de stats — la del ranking y la de cada jugador con
--      sesión (src/lib/statsService.js). Lo cazó test-rls.mjs: «[stats] SELECT
--      debería estar permitido (ranking)».
--
--   2) FALLA ABIERTO, que es la peligrosa. Al acotar profiles_select a la fila
--      propia [bloque 3], esa subconsulta dejó de ver la fila del usuario
--      marcado. `NOT EXISTS` sobre algo que ya no puedes ver da TRUE, así que
--      las stats de una cuenta shadowbaneada volvían a ser visibles. Endurecer
--      una policy AFLOJÓ otra, en silencio y sin que nada fallara.
--
-- ============================================================================
-- POR QUÉ REVERTIR ES CORRECTO Y NO UNA RENDICIÓN
-- ============================================================================
-- El motivo por el que se tocó la policy era que `select * from profiles`
-- servía el nombre real y la foto de Google. Esas dos columnas YA NO EXISTEN
-- (bloque [2], irreversible), así que la lectura pública ya no filtra ningún
-- dato personal: quedan id, updated_at, display_name e is_flagged, y de esos
-- display_name es público por diseño —sale en la clasificación— e is_flagged
-- siempre vale false en las filas que se llegan a ver.
--
-- Es decir: la fuga está cerrada por [2]. [3] y [4] eran endurecimiento extra, y
-- ese endurecimiento resultó tener un coste que no se vio venir. Volver al
-- estado conocido-bueno es lo correcto; rehacerlo bien es otra tarea, con la
-- policy de stats delante y no de refilón.
--
-- Cómo se haría bien, para quien lo retome: mover el chequeo de is_flagged a una
-- función SECURITY DEFINER —p.ej. `public.esta_marcado(uuid)`— y que AMBAS
-- policies la llamen. Así la comprobación deja de depender de los privilegios
-- del llamante y acotar profiles no puede volver a aflojar stats. Eso hay que
-- hacerlo con las dos policies a la vista y su test delante.
--
-- Ejecutar UNA vez en el SQL Editor de Supabase.

begin;

-- [3-revert] La policy vuelve a su forma de junio
-- (2026-06-rls-performance-lints.sql). `(select auth.uid())` y no `auth.uid()`
-- a pelo: es la forma que evalúa el InitPlan una vez en vez de por fila.
drop policy if exists profiles_select on public.profiles;

create policy profiles_select on public.profiles
  for select
  using ((id = (select auth.uid())) or (not is_flagged));

-- [4-revert] El GRANT vuelve a ser de tabla. Sin esto, la subconsulta de
-- stats_select sigue sin poder mirar profiles y las stats siguen rotas.
grant select on public.profiles to anon, authenticated;

commit;

-- ============================================================================
-- COMPROBACIÓN
-- ============================================================================
-- 1) La policy volvió a las dos condiciones.
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT';

-- 2) Las columnas de Google SIGUEN eliminadas: esto NO se revierte.
--    Debe devolver 0 filas.
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in ('username', 'avatar_url');

-- 3) Y lo que motivó todo esto: `npm run test:rls` debe volver a 34 OK, 0 FAIL.
