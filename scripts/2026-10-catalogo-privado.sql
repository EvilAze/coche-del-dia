-- scripts/2026-10-catalogo-privado.sql
-- El catálogo deja de leerse directamente de Supabase con la anon key.
--
-- POR QUÉ. /api/list-cars pasa a contestar solo a nuestra propia página
-- (api/_lib/origen-propio.js), pero eso no servía de nada mientras PostgREST
-- siguiera sirviendo `cars?select=make,model,year,pais,image_ready` a `anon`:
-- la anon key viaja en el bundle del navegador, así que cualquiera podía
-- saltarse el endpoint y pedirle el catálogo a la base. Ahora list-cars lee con
-- service_role y estas columnas pierden su GRANT.
--
-- `image_ready` además decía qué coches NO pueden ser el coche del día
-- (pick_daily_car solo sortea entre los que tienen foto): el panel lo lee por
-- /api/admin/pendientes-imagen, también con service_role.
--
-- `id` SE QUEDA con su GRANT a propósito: lo usan el sondeo de salud
-- (api/_lib/health.js, «¿contesta la base por el mismo camino que un jugador?»)
-- y el «/465» del Perfil (statsService.getCatalogCount, un count). Un id suelto
-- es un UUID que no nombra ningún coche.
--
-- ORDEN: ejecutar DESPUÉS de que el despliegue con el nuevo list-cars esté en
-- producción. Antes, el list-cars viejo (cliente anónimo) se quedaría sin
-- catálogo y el cupón sin marcas.
--
-- Idempotente: revocar lo que ya no está concedido no falla.

BEGIN;

REVOKE SELECT (make, model, year, pais, image_ready)
  ON public.cars
  FROM anon, authenticated;

COMMIT;

-- Verificación: lo único que debe quedar para anon/authenticated es `id`.
SELECT grantee, column_name
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name = 'cars'
  AND privilege_type = 'SELECT'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, column_name;
