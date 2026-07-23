-- scripts/2026-07-rareza-portadas.sql
-- RAREZA DE PORTADAS (Fase 3 de El Archivo). Responde a la pregunta que
-- convierte una cuadrícula en una colección: «¿cuánta gente tiene este cromo?».
--
-- Sin esto, tu portada y la mía son idénticas. Con esto, una portada que solo
-- tiene el 8 % de coleccionistas VALE distinto — y el valor es la razón de ser
-- de coleccionar.
--
-- QUÉ MIDE (y qué NO):
--   rarity_pct = coleccionistas que la tienen / coleccionistas totales.
--   NO es dificultad. La dificultad ya vive en cars.difficulty_* (leída de
--   daily_stats, que incluye anónimos y mide la jornada). Esta métrica es de
--   POSESIÓN: mide el reparto real del cromo entre la gente registrada.
--
--   Efecto cohorte: un coche que salió cuando había 30 usuarios tendrá un
--   porcentaje bajo aunque fuese fácil, porque el denominador de HOY es mayor.
--   Eso NO es un defecto que haya que corregir: es exactamente cómo funciona
--   un coleccionable real —los números antiguos son escasos porque había menos
--   gente— y es la lectura que el jugador espera de un archivo de ediciones.
--
--   «Coleccionista» = usuario con AL MENOS una victoria. Usar todos los
--   perfiles registrados metería en el denominador a quien se registró y no
--   jugó, aplastando todos los porcentajes hacia cero.
--
-- POR QUÉ PRECALCULADO Y NO EN VIVO:
--   Es un COUNT(DISTINCT user_id) agrupado sobre user_guesses entero. Hacerlo
--   en cada apertura de El Archivo sería pagar un escaneo completo por usuario
--   y por visita, cuando el dato solo cambia de forma perceptible entre días.
--   Lo recalcula el cron nocturno (warm-daily, PASO 7).
--
-- Ejecutar una vez en el SQL Editor de Supabase. Idempotente
-- (IF NOT EXISTS / CREATE OR REPLACE): re-ejecutable sin efectos colaterales.

-- ============================================================================
-- 1) COLUMNAS DE RAREZA en public.cars
-- ============================================================================
-- ADMIN-ONLY, igual que las columnas difficulty_* del observatorio: NO se hace
-- GRANT a anon/authenticated a propósito. /api/list-cars proyecta columnas
-- explícitas (no pide estas), así que no aplica el GRANT del CLAUDE.md #3 y no
-- se rompe. Quien las sirve al cliente es /api/garage con service_role, y solo
-- para cromos YA DESBLOQUEADOS.
alter table public.cars
  add column if not exists rarity_owners      integer,     -- coleccionistas que la tienen
  add column if not exists rarity_collectors  integer,     -- denominador del cálculo
  add column if not exists rarity_pct         real,        -- 0..100
  add column if not exists rarity_computed_at timestamptz;

comment on column public.cars.rarity_pct is
  'Porcentaje de coleccionistas (usuarios con >=1 victoria) que han ganado este coche. Lo escribe recompute_cover_rarity() desde el cron nocturno. NO es dificultad: eso es difficulty_*.';
comment on column public.cars.rarity_collectors is
  'Denominador usado en el ultimo calculo. Se guarda por coche para poder auditar un rarity_pct antiguo sin recalcular.';

-- ============================================================================
-- 2) recompute_cover_rarity() — el recuento
-- ============================================================================
-- SECURITY DEFINER: necesita leer user_guesses de TODOS los usuarios, y su RLS
-- restringe cada fila a su dueño. Por eso no puede ejecutarla el cliente: se
-- revoca a anon/authenticated y solo se concede a service_role (el cron).
--
-- Devuelve el nº de coches actualizados. Los coches sin ninguna victoria se
-- ponen a 0 explícitamente (y no a NULL) para poder distinguir «nadie la
-- tiene» de «aún no se ha calculado nunca».
create or replace function public.recompute_cover_rarity()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_collectors integer := 0;
  v_updated    integer := 0;
begin
  -- Denominador: coleccionistas = usuarios con al menos una victoria.
  select count(distinct user_id) into v_collectors
  from public.user_guesses
  where status = 'won';

  if v_collectors is null or v_collectors = 0 then
    -- Juego recién estrenado: no hay nada que repartir. Dejamos las columnas
    -- como estén en vez de escribir ceros que el front tendría que ignorar.
    return 0;
  end if;

  with owners as (
    select car_id, count(distinct user_id)::integer as n
    from public.user_guesses
    where status = 'won'
    group by car_id
  ),
  -- LEFT JOIN contra el catálogo entero: los coches que nadie ha ganado no
  -- aparecen en `owners` y tienen que quedarse en 0, no en NULL.
  por_coche as (
    select c.id, coalesce(o.n, 0) as n
    from public.cars c
    left join owners o on o.car_id = c.id
  )
  update public.cars c
  set
    rarity_owners      = p.n,
    rarity_collectors  = v_collectors,
    -- Redondeo a una décima: «12.3 %» ya es más precisión de la que el dato
    -- soporta, y evita que el front tenga que redondear por su cuenta.
    rarity_pct         = round((p.n::numeric * 100 / v_collectors), 1)::real,
    rarity_computed_at = now()
  from por_coche p
  where c.id = p.id;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- Solo el cron (service_role) o el owner desde el SQL editor pueden ejecutarla.
revoke all on function public.recompute_cover_rarity() from public;
revoke all on function public.recompute_cover_rarity() from anon, authenticated;
grant execute on function public.recompute_cover_rarity() to service_role;

-- ============================================================================
-- 3) USO MANUAL
-- ============================================================================
--   -- Recalcular ahora (lo hace el cron cada noche, PASO 7 de warm-daily):
--   SELECT public.recompute_cover_rarity();
--
--   -- Las 20 portadas más escasas (las que un coleccionista presume):
--   SELECT make, model, year, rarity_owners, rarity_collectors, rarity_pct
--   FROM public.cars
--   WHERE rarity_owners > 0
--   ORDER BY rarity_pct ASC
--   LIMIT 20;
--
--   -- Salud del dato: ¿cuándo se calculó y con cuántos coleccionistas?
--   SELECT max(rarity_computed_at) AS ultimo_calculo,
--          max(rarity_collectors)  AS coleccionistas
--   FROM public.cars;
