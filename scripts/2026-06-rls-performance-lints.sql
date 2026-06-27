-- 2026-06-rls-performance-lints.sql
-- Cierra los avisos de PERFORMANCE del Supabase Database Linter sobre RLS:
--   - auth_rls_initplan (0003): auth.uid() reevaluado por fila.
--   - multiple_permissive_policies (0006): policies permisivas solapadas en
--     profiles para el mismo rol+acción.
-- Ejecutar UNA vez en el SQL Editor de Supabase. Solo cambia RLS de rendimiento;
-- el acceso efectivo (quién ve/escribe qué) NO cambia.
--
-- Estas policies se crearon en su día desde el dashboard (no estaban en
-- scripts/); este archivo las deja por fin versionadas.

-- ============================================================================
-- 1) profiles: eliminar la policy catch-all redundante
-- ============================================================================
-- "Users manage their own profile" (FOR ALL, rol public, auth.uid() = id)
-- solapa con las policies granulares que ya existen:
--   profiles_select       (SELECT, public)
--   "profiles own insert" (INSERT, authenticated)
--   "profiles own update" (UPDATE, authenticated)
-- Eso dispara los 7 avisos multiple_permissive_policies (Postgres evalúa DOS
-- policies por cada rol+acción) y el initplan de la propia catch-all.
--
-- Las granulares cubren SELECT/INSERT/UPDATE con idéntica lógica de "solo lo
-- propio". Lo ÚNICO que aportaba la catch-all era DELETE del perfil propio, que
-- NO usa la app: ninguna ruta de cliente borra profiles, y un eventual borrado
-- de cuenta iría por service_role (que se salta RLS). Si en el futuro se añade
-- self-service delete desde el cliente, crear entonces una policy granular
-- "profiles own delete" (authenticated, USING (select auth.uid()) = id).
DROP POLICY IF EXISTS "Users manage their own profile" ON public.profiles;

-- ============================================================================
-- 2) auth_rls_initplan: cachear auth.uid() con (select auth.uid())
-- ============================================================================
-- Envolver auth.uid() en un subselect hace que Postgres lo evalúe UNA vez
-- (InitPlan) en lugar de por fila. La expresión lógica es la misma.
-- Usamos ALTER POLICY (no DROP+CREATE) para conservar rol/acción y no dejar
-- ninguna ventana sin policy. "profiles own insert/update" ya estaban
-- optimizadas; no se tocan.

-- profiles_select: lectura del perfil propio O de cualquier perfil no marcado.
ALTER POLICY profiles_select ON public.profiles
  USING ((id = (SELECT auth.uid())) OR (NOT is_flagged));

-- stats_select: stats propias O de un perfil que no esté marcado como flagged.
ALTER POLICY stats_select ON public.stats
  USING (
    (user_id = (SELECT auth.uid()))
    OR (NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = stats.user_id AND p.is_flagged = true
    ))
  );

-- user_guesses: cada usuario lee solo sus propias jugadas.
ALTER POLICY "user reads own user_guesses" ON public.user_guesses
  USING ((SELECT auth.uid()) = user_id);
