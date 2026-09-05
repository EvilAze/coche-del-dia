-- 2026-09-lockdown-ficha-rendimiento.sql
-- TERCERA pasada del mismo lockdown. Ver 2026-06-lockdown-securitydefiner-grants.sql
-- y su v2 de agosto: el patrón se repitió, esta vez sobre las dos funciones de
-- la ficha de rendimiento recién creadas en 2026-09-ficha-rendimiento-coche.sql.
--
-- QUÉ SE FILTRABA, comprobado contra producción el 2026-09-05 con la anon key:
--
--   list_car_reports()  →  el CALENDARIO ENTERO. car_id, marca, modelo, año y
--                          aired_on: qué coche salió cada día. Y como filtra por
--                          `daily_stats.total_games > 0`, el coche de HOY entra
--                          en la lista en cuanto la primera persona termina su
--                          partida. Eso es la regla 5 del CLAUDE.md rota de
--                          principio a fin: no hay que adivinar nada, se pide.
--   get_car_report(uuid) →  menos grave por sí sola (hay que saber el uuid del
--                          coche), pero cruzada con el catálogo público de
--                          /api/list-cars da la fecha de emisión de cualquiera.
--
-- POR QUÉ VOLVIÓ A PASAR: los scripts se escribieron copiando el patrón que se
-- ve en el resto del repo —`REVOKE ALL ON FUNCTION ... FROM PUBLIC`— que parece
-- el correcto y no lo es. Supabase concede EXECUTE a `anon` y `authenticated`
-- DIRECTAMENTE (vía ALTER DEFAULT PRIVILEGES) sobre cada función nueva del
-- esquema public; revocar de PUBLIC no toca un grant directo a un rol. La
-- lección de junio y de agosto estaba escrita, pero en OTRO fichero, y quien
-- escribe una función nueva mira la función de al lado, no el lockdown.
--
-- POR ESO, ADEMÁS DE ESTE ARREGLO, hay dos cosas que no son SQL:
--   · scripts/2026-09-ficha-rendimiento-coche.sql lleva ahora el revoke correcto
--     Y el porqué al lado, para que copiar de él sea copiar lo bueno.
--   · scripts/test-rls.mjs comprueba las dos funciones. Es la parte que importa:
--     una lección documentada depende de que alguien se acuerde; un test, no.
--
-- Ejecutar UNA vez en el SQL Editor de Supabase. Idempotente (revocar un
-- privilegio ausente no falla).

revoke execute on function public.get_car_report(uuid)
  from anon, authenticated;

revoke execute on function public.list_car_reports()
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- COMPROBACIÓN
-- ---------------------------------------------------------------------------
-- Debe devolver 0 filas: ninguna de las dos ejecutable por anon/authenticated.
select p.proname, r.rolname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join aclexplode(p.proacl) a on true
join pg_roles r on r.oid = a.grantee
where n.nspname = 'public'
  and p.proname in ('get_car_report', 'list_car_reports')
  and r.rolname in ('anon', 'authenticated')
  and a.privilege_type = 'EXECUTE';

-- Y el panel debe seguir pudiendo llamarlas (debe devolver 2 filas).
select p.proname, r.rolname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join aclexplode(p.proacl) a on true
join pg_roles r on r.oid = a.grantee
where n.nspname = 'public'
  and p.proname in ('get_car_report', 'list_car_reports')
  and r.rolname = 'service_role'
  and a.privilege_type = 'EXECUTE';
