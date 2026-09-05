-- 2026-09-arreglo-sobrecarga-dificultad.sql
-- ARREGLO del bug que dejó el bloque de dificultad del panel diciendo «sin
-- datos de telemetría todavía» durante meses.
--
-- QUÉ PASABA, confirmado contra la base el 2026-09-05:
--
--     ERROR 42725: function public.recompute_car_difficulty() is not unique
--     HINT: Could not choose a best candidate function.
--
-- Convivían DOS sobrecargas de recompute_car_difficulty:
--   · la de OCHO argumentos, de 2026-06-difficulty-observatory.sql;
--   · la de NUEVE, de 2026-06-difficulty-significance-gate.sql (añade p_z_gate,
--     y es la buena: ajusta el umbral a una audiencia pequeña).
-- El gate dropea la de 8 al instalarse, pero el observatory se anunciaba como
-- «re-ejecutable sin efectos colaterales», así que volver a lanzarlo la recreó.
--
-- Con las dos vivas, `rpc("recompute_car_difficulty")` SIN argumentos no puede
-- resolverse. Y como el GET del panel envolvía esa llamada en un try/catch que
-- no miraba `error` —y supabase-js NO lanza ante un error de Postgres: resuelve
-- con { data, error }—, el fallo no dejaba ni una línea de log. Por eso el
-- síntoma («sin datos») no se parecía en nada a la causa.
--
-- El try/catch mudo ya está arreglado en lib/admin-handlers/save-car.js. Esto
-- arregla la otra mitad: dejar UNA sola sobrecarga.
--
-- Idempotente: si la de 8 ya no está, el drop no hace nada.

-- ============================================================================
-- 1) ANTES: qué firmas existen
-- ============================================================================
-- Una sola fila con «p_z_gate» dentro = ya está arreglado, no hace falta nada.
select
  pg_get_function_identity_arguments(p.oid) as argumentos,
  case
    when pg_get_function_identity_arguments(p.oid) like '%p_z_gate%'
      then 'la BUENA (significance gate)'
    else 'la VIEJA (a dropear)'
  end as cual_es
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'recompute_car_difficulty';

-- ============================================================================
-- 2) Dropear SOLO la vieja
-- ============================================================================
-- La firma va explícita para no tocar la de 9 argumentos por accidente: sin
-- ella, un `drop function` a secas sobre un nombre ambiguo tampoco sabría a
-- cuál referirse.
drop function if exists public.recompute_car_difficulty(
  real, real, real, real, integer, real, real, real
);

-- ============================================================================
-- 3) DESPUÉS: comprobar que la llamada ya se resuelve
-- ============================================================================
-- Devuelve el nº de coches actualizados. Si sigue dando 42725, es que hay más
-- de dos sobrecargas: mira la salida del paso 1 y dropea las sobrantes por su
-- firma exacta.
select public.recompute_car_difficulty() as coches_actualizados;

-- ¿Quedó escrito? con_dificultad tiene que ser > 0 si hay días jugados.
-- Recuentos, no listas: este repo es PÚBLICO (regla 20 del CLAUDE.md).
select
  count(*) filter (where difficulty_n is not null)        as con_dificultad,
  count(*) filter (where suggested_zoom_base is not null) as con_sugerencia,
  count(*)                                                as coches_totales,
  max(difficulty_computed_at)                             as ultimo_calculo
from public.cars;
