-- scripts/2026-10-bonus-racha-revertir.sql
--
-- DESHACE scripts/2026-10-bonus-racha-en-clasificacion.sql: la clasificación
-- vuelve a contar solo los puntos base.
--
-- NO vuelvas a ejecutar scripts/2026-09-ranking-semanal.sql ni
-- supabase-monthly-ranking.sql para «volver atrás»: son las copias del repo y
-- sobrescribirían en silencio los filtros que se han parcheado en producción
-- desde entonces (la exclusión de clasificación, entre otros). Este script
-- invierte EXACTAMENTE las tres sustituciones que hizo el de aplicar y deja el
-- resto de la función como esté.
--
-- Idempotente. Deja bonus_racha_diaria() instalada (inofensiva, privada).
-- Si ya no se va a usar:  DROP FUNCTION public.bonus_racha_diaria(date, date);

DO $revertir$
DECLARE
  r            record;
  v_def        text;
  v_pts_viejo  text;
  v_pts_nuevo  text;
  v_from_viejo text;
  v_from_nuevo text;
  v_cte_nuevo  text;
  v_revertidas int := 0;
  v_saltadas   int := 0;
BEGIN
  FOR r IN
    SELECT pr.oid, pr.proname, pg_get_functiondef(pr.oid) AS def
    FROM pg_proc pr
    JOIN pg_namespace n ON n.oid = pr.pronamespace
    WHERE n.nspname = 'public'
      AND pr.prokind = 'f'
      AND pr.proname IN ('get_season_leaderboard', 'get_monthly_leaderboard')
  LOOP
    v_def := r.def;

    IF position('bonus_racha_diaria' in v_def) = 0 THEN
      RAISE NOTICE '[revertir] %: ya cuenta solo puntos base. Nada que hacer.', r.proname;
      CONTINUE;
    END IF;

    IF r.proname = 'get_season_leaderboard' THEN
      v_pts_viejo  := $q$SUM(CASE WHEN s2.is_daily THEN s2.base ELSE CEIL(s2.base/2.0) END)::int AS points,$q$;
      v_pts_nuevo  := $q$(SUM(CASE WHEN s2.is_daily THEN s2.base ELSE CEIL(s2.base/2.0) END) + COALESCE(MAX(bu.bonus), 0))::int AS points,$q$;
      v_from_viejo := $q$FROM scored s2$q$;
      v_from_nuevo := $q$FROM scored s2 LEFT JOIN bonus_usuario bu ON bu.user_id = s2.user_id$q$;
      v_cte_nuevo  := $q$bonus_usuario AS (
    SELECT b.user_id, SUM(b.bonus)::int AS bonus
    FROM public.bonus_racha_diaria(v_starts_at, v_ends_at) b
    GROUP BY b.user_id
  ),
  agg AS ($q$;
    ELSE
      v_pts_viejo  := $q$SUM(CASE WHEN s.is_daily THEN s.base ELSE CEIL(s.base / 2.0) END)::int AS points,$q$;
      v_pts_nuevo  := $q$(SUM(CASE WHEN s.is_daily THEN s.base ELSE CEIL(s.base / 2.0) END) + COALESCE(MAX(bu.bonus), 0))::int AS points,$q$;
      v_from_viejo := $q$FROM scored s$q$;
      v_from_nuevo := $q$FROM scored s LEFT JOIN bonus_usuario bu ON bu.user_id = s.user_id$q$;
      v_cte_nuevo  := $q$bonus_usuario AS (
    SELECT b.user_id, SUM(b.bonus)::int AS bonus
    FROM bounds, public.bonus_racha_diaria(bounds.start, (bounds.stop - 1)) b
    GROUP BY b.user_id
  ),
  agg AS ($q$;
    END IF;

    -- Solo se revierte si las tres piezas están TAL CUAL las dejó el script de
    -- aplicar; si alguien tocó la función después, no se adivina.
    IF position(v_pts_nuevo in v_def) = 0
       OR position(v_from_nuevo in v_def) = 0
       OR position(v_cte_nuevo in v_def) = 0 THEN
      v_saltadas := v_saltadas + 1;
      RAISE NOTICE '[revertir] %: AVISO, el parche no está como lo dejó el script de aplicar. NO se ha tocado.', r.proname;
      CONTINUE;
    END IF;

    v_def := replace(v_def, v_pts_nuevo,  v_pts_viejo);
    v_def := replace(v_def, v_from_nuevo, v_from_viejo);
    v_def := replace(v_def, v_cte_nuevo,  'agg AS (');

    EXECUTE v_def;
    v_revertidas := v_revertidas + 1;
    RAISE NOTICE '[revertir] %: revertida.', r.proname;
  END LOOP;

  IF v_saltadas > 0 THEN
    RAISE NOTICE '[revertir] PENDIENTE: % funcion(es) sin revertir.', v_saltadas;
  END IF;
END
$revertir$;

-- Verificación: las dos deben salir con suma_bonus = false.
SELECT pr.proname,
       position('bonus_racha_diaria' in pg_get_functiondef(pr.oid)) > 0 AS suma_bonus
FROM pg_proc pr
JOIN pg_namespace n ON n.oid = pr.pronamespace
WHERE n.nspname = 'public'
  AND pr.prokind = 'f'
  AND pr.proname IN ('get_season_leaderboard', 'get_monthly_leaderboard')
ORDER BY pr.proname;
