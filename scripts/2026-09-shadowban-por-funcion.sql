-- 2026-09-shadowban-por-funcion.sql
-- Saca el chequeo de shadowban de las policies y lo mete en UNA función
-- SECURITY DEFINER, para poder cerrar la lectura pública de profiles sin
-- romper la de stats.
--
-- ⚠️ ANTES DE EJECUTAR: pasa la comprobación previa del final de esta cabecera
--    (bloque «PREVUELO»). Este script se escribió después de romper producción
--    por no hacerla.
--
-- ============================================================================
-- POR QUÉ HACE FALTA UNA FUNCIÓN
-- ============================================================================
-- Dos policies comparten el mismo chequeo, y una de ellas lo hace LEYENDO la
-- tabla de la otra:
--
--   profiles_select  USING (id = auth.uid() OR NOT is_flagged)
--   stats_select     USING (user_id = auth.uid()
--                           OR NOT EXISTS (SELECT 1 FROM profiles p
--                                          WHERE p.id = stats.user_id
--                                            AND p.is_flagged = true))
--
-- Las expresiones de RLS se evalúan CON LOS PRIVILEGIOS DEL QUE CONSULTA y
-- SUJETAS A LA RLS de las tablas que tocan. De ahí que, al intentar cerrar
-- profiles el 2026-09-05, saltaran dos averías a la vez:
--
--   · revocar SELECT sobre profiles → la subconsulta de stats_select falla con
--     42501 y se cae TODA lectura de stats, la del ranking y la de cada jugador
--     con sesión. Ruidosa, se vio enseguida.
--   · acotar profiles_select a la fila propia → la subconsulta deja de ver la
--     fila del usuario marcado, y `NOT EXISTS` sobre algo que ya no puedes ver
--     da TRUE. Las stats de una cuenta shadowbaneada volvían a ser visibles.
--     SILENCIOSA: endurecer una policy aflojó la otra sin que nada fallara.
--
-- Con el chequeo dentro de una función SECURITY DEFINER, el cuerpo corre como
-- el dueño: ve profiles entera, sin RLS y sin depender de los GRANT del
-- llamante. Entonces las dos policies pueden endurecerse por separado sin
-- pisarse.
--
-- ============================================================================
-- LO QUE ESTO EXPONE, DICHO CLARO
-- ============================================================================
-- `esta_marcado(uuid)` hay que otorgárselo a anon/authenticated: la policy la
-- evalúa el llamante y sin EXECUTE no puede. O sea que cualquiera puede
-- preguntar «¿está marcada la cuenta X?» y obtener un sí/no.
--
-- No es información nueva: HOY ya se deduce igual, porque profiles_select
-- esconde la fila de una cuenta marcada y basta con notar que falta. Lo que sí
-- cambia es la ergonomía — pasa de inferencia a consulta directa. Se acepta a
-- cambio de cerrar la lectura pública de profiles, y queda escrito aquí para
-- que sea una decisión y no un descuido.
--
-- Quien quiera cerrar también eso tiene un camino mejor y más corto, apuntado
-- al final del script: la lectura pública de stats parece TAN vestigial como la
-- de profiles.
--
-- Ejecutar UNA vez en el SQL Editor de Supabase.

begin;

-- ============================================================================
-- [1] El chequeo, en un solo sitio
-- ============================================================================
-- `search_path = public, pg_temp` y no `= public` a secas: si pg_temp NO se
-- nombra, Postgres busca el esquema temporal PRIMERO de forma implícita, y
-- entonces cualquiera que pueda crear tablas temporales coloca un `profiles`
-- que enmascara al de verdad. Nombrarlo al final es lo que lo manda al último
-- lugar. Es la protección estándar de una función SECURITY DEFINER.
create or replace function public.esta_marcado(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.is_flagged = true
  );
$$;

-- EXECUTE a anon/authenticated es OBLIGATORIO, no una concesión: la policy la
-- evalúa el llamante (ver «LO QUE ESTO EXPONE» arriba).
revoke all on function public.esta_marcado(uuid) from public;
grant execute on function public.esta_marcado(uuid) to anon, authenticated;

-- ============================================================================
-- [2] stats_select deja de leer profiles
-- ============================================================================
-- Mismo significado que antes —tus stats, o las de quien no esté marcado— pero
-- sin depender de los privilegios ni de la RLS de profiles.
--
-- ALTER POLICY y no DROP+CREATE: así se conserva el resto de la definición
-- (roles, tipo) y es como ya la tocó 2026-06-rls-performance-lints.sql.
alter policy stats_select on public.stats
  using (
    (user_id = (select auth.uid()))
    or (not public.esta_marcado(stats.user_id))
  );

-- ============================================================================
-- [3] profiles_select: solo tu propia fila
-- ============================================================================
-- Ahora sí se puede, porque [2] ya no depende de esta policy.
--
-- La lectura pública era de cuando la clasificación consultaba stats con join a
-- profiles — lo cuenta en pasado src/lib/statsService.js:327. Hoy todos los
-- caminos que enseñan un nick ajeno son SECURITY DEFINER con su propio filtro
-- de is_flagged (get_public_profile, get_legends_leaderboard,
-- get_season_leaderboard, get_champions, get_my_season_rank), y el cliente solo
-- toca profiles para SU fila (statsService.js:35 y :148).
drop policy if exists profiles_select on public.profiles;

create policy profiles_select on public.profiles
  for select
  using (id = (select auth.uid()));

-- ============================================================================
-- [4] GRANT por columna
-- ============================================================================
-- Con [2] ya independiente, revocar aquí no rompe stats.
--   · `select *` pasa a fallar con 42501 en vez de devolver lista vacía: un
--     permiso denegado se lee mucho mejor que un resultado vacío, que se
--     confunde con «no hay datos».
--   · una cuenta marcada deja de poder leer su propio is_flagged. Con la policy
--     vieja podía, porque `id = auth.uid()` la dejaba pasar y la columna
--     viajaba de propina en el `select *`.
--
-- El cliente solo necesita id y display_name (src/lib/statsService.js).
revoke select on public.profiles from anon, authenticated;
grant  select (id, display_name) on public.profiles to authenticated;

commit;

-- ============================================================================
-- COMPROBACIÓN
-- ============================================================================
-- 1) La policy de stats ya no menciona profiles, y la de profiles es de una
--    sola condición.
select tablename, policyname, qual
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'stats')
  and cmd = 'SELECT';

-- 2) EL CHEQUEO QUE IMPORTA: el shadowban sigue actuando sobre stats. Debe
--    devolver `true` en la primera columna si hay alguna cuenta marcada, y las
--    dos cifras tienen que DIFERIR — si coinciden, el filtro no está filtrando.
select
  (select count(*) from public.profiles where is_flagged = true) > 0 as hay_marcadas,
  (select count(*) from public.stats)                                as stats_totales,
  (select count(*) from public.stats s
    where not public.esta_marcado(s.user_id))                        as stats_no_marcadas;

-- 3) Las RPC públicas siguen sirviendo nicks. Debe devolver filas.
select count(*) as leyendas_visibles from public.get_legends_leaderboard(5);

-- 4) Y la de verdad, desde fuera: `npm run test:rls` debe dar 34 OK, 0 FAIL.
--    Es la primera vez desde mayo de 2026 que puede darlo.

-- ============================================================================
-- PENDIENTE, PARA QUIEN LO RETOME
-- ============================================================================
-- La lectura pública de `stats` parece TAN vestigial como lo era la de
-- profiles: las dos únicas lecturas del cliente son de fila propia
-- (statsService.js:57 y :193, ambas con .eq("user_id", …)) y la clasificación
-- va por RPC. Si se confirma, stats_select puede acotarse también a la fila
-- propia y entonces `esta_marcado` deja de necesitar EXECUTE para anon /
-- authenticated — con lo que desaparece el oráculo de shadowban que este script
-- acepta a conciencia.
--
-- No se hace aquí porque scripts/test-rls.mjs afirma explícitamente que el
-- SELECT público de stats DEBE estar permitido, y esa afirmación es de cuando
-- el ranking sí lo usaba. Cambiar una aserción de un test de seguridad merece
-- su propia tarea y su propia comprobación, no ir de polizón en esta.
