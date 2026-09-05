-- 2026-09-stats-solo-fila-propia.sql
-- Acota la lectura de public.stats a la fila propia, y con ello retira el
-- oráculo de shadowban que 2026-09-shadowban-por-funcion.sql había aceptado a
-- conciencia.
--
-- ⚠️ ANTES DE EJECUTAR: pasa el prevuelo (S1/S2/S3, al final de esta cabecera).
--
-- ============================================================================
-- POR QUÉ LA LECTURA PÚBLICA DE stats YA NO LA USA NADIE
-- ============================================================================
-- Es el mismo caso que profiles, y por el mismo motivo: la policy es de cuando
-- la clasificación consultaba stats DIRECTAMENTE. El propio código lo cuenta en
-- pasado (src/lib/statsService.js:327) y el test lo repite como premisa —«el
-- ranking lo lee cualquiera (anon incluido)»—, pero eso dejó de ser verdad
-- cuando los leaderboards se convirtieron en RPC SECURITY DEFINER.
--
-- Comprobado sitio por sitio, cliente y servidor:
--   · src/lib/statsService.js:57 y :193 — las dos con .eq("user_id", …): FILA
--     PROPIA. Son las ÚNICAS lecturas de stats en todo src/ (fuera de admin), y
--     no hay ni un join embebido de PostgREST hacia stats.
--   · api/garage.js:237 — la única del servidor que usa `authClient` (o sea, la
--     única sujeta a RLS): también .eq("user_id", user.id).
--   · api/_lib/repesca/{image,start,validate}.js y lib/admin-handlers/
--     analytics.js — todas con getSupabaseAdmin() (service_role), que se salta
--     RLS y no le afecta esta policy.
--
-- O sea: nadie lee stats ajenas por esta vía. Solo estaba expuesta.
--
-- ============================================================================
-- QUÉ SE GANA, ADEMÁS DE CERRAR
-- ============================================================================
-- Desaparece el oráculo de shadowban. `esta_marcado(uuid)` se creó para que las
-- policies de profiles y stats dejaran de estar acopladas, y hubo que otorgarle
-- EXECUTE a anon/authenticated porque la policy la evalúa el llamante — con lo
-- que cualquiera podía preguntar «¿está marcada la cuenta X?». Se aceptó a
-- cambio de poder cerrar profiles, y se dejó escrito que el camino bueno era
-- este.
--
-- Con stats acotada a la fila propia YA NO HAY POLICIES ACOPLADAS: nadie puede
-- leer filas ajenas de ninguna de las dos tablas, marcada o no. El shadowban
-- sigue actuando donde de verdad importa —dentro de las RPC, cada una con su
-- `p.is_flagged IS NOT TRUE`, que es lo que montó 2026-08-unificar-shadowban.sql—
-- y la función puente deja de tener razón de existir.
--
-- Por eso se ELIMINA en vez de dejarla revocada: existía para resolver un
-- acoplamiento que ya no existe. Guardarla «por si acaso» sería dejar una
-- función SECURITY DEFINER viva sin ningún llamador.
--
-- Ejecutar UNA vez en el SQL Editor de Supabase.

begin;

-- ============================================================================
-- [1] stats: solo tu propia fila
-- ============================================================================
-- ALTER POLICY y no DROP+CREATE, para conservar roles y tipo — igual que
-- 2026-06-rls-performance-lints.sql. `(select auth.uid())` mantiene el InitPlan
-- que pide el lint de rendimiento.
--
-- Las sesiones anónimas de Supabase siguen leyendo lo suyo: viajan como
-- `authenticated` con el claim is_anonymous, así que tienen auth.uid().
alter policy stats_select on public.stats
  using (user_id = (select auth.uid()));

-- ============================================================================
-- [2] Fuera el puente, que ya no une nada
-- ============================================================================
-- Sin llamadores: [1] fue el último. Se comprueba antes de tirarla — si algo la
-- usara, este bloque lo dice y aborta la transacción entera en vez de dejar una
-- policy rota.
do $$
declare
  v_usos int;
begin
  select count(*) into v_usos
  from pg_policies
  where schemaname = 'public'
    and (qual ilike '%esta_marcado%' or with_check ilike '%esta_marcado%');

  if v_usos > 0 then
    raise exception
      'esta_marcado sigue usada por % policy(s): revísalas antes de eliminarla', v_usos;
  end if;
end
$$;

drop function if exists public.esta_marcado(uuid);

commit;

-- ============================================================================
-- COMPROBACIÓN
-- ============================================================================
-- 1) La policy quedó en una sola condición y sin rastro de esta_marcado.
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'stats' and cmd = 'SELECT';

-- 2) Las RPC del ranking siguen sirviendo: son SECURITY DEFINER y se saltan
--    RLS. Las tres deben devolver filas.
select
  (select count(*) from public.get_legends_leaderboard(5)) as leyendas,
  (select count(*) from public.get_champions(5))           as campeones,
  (select count(*) from public.get_monthly_leaderboard(current_date, 5)) as mensual;

-- 3) EL CHEQUEO QUE IMPORTA, desde fuera: un anónimo no debe ver NINGUNA fila
--    de stats, y un jugador con sesión debe seguir viendo la suya. Eso lo mide
--    `npm run test:rls`, que hay que actualizar en el mismo commit — su
--    aserción actual («SELECT permitido, el ranking lo lee cualquiera») es de
--    cuando el ranking sí lo leía.
