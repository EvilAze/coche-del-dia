# Temporadas Temáticas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el ranking mensual por **Temporadas Temáticas** (ciclos de 1-2 semanas con temática), sin cambiar el juego diario ni saturar la interfaz. Modelo de 3 capas: Temporada (presente, modal de vista única) · Leyendas (histórico all-time, en el perfil) · Salón de la Fama (campeones congelados por temporada).

**Architecture:** Las Temporadas son el ranking mensual **generalizado**: misma derivación de puntos base desde `user_guesses` (10/6/4/3/2/1 por intento, repesca a mitad, sin bonus de racha), solo que los límites salen de la fila `seasons` (`starts_at`/`ends_at`) en vez de `date_trunc('month')`. Se clonan `monthly_podium`→`season_podium` y se reapunta `snapshot_daily_ranks()` (movimiento vs ayer del *parte*) al leaderboard de temporada. El cierre de temporada va *piggyback* en el cron `warm-daily` (límite de 2 crons en Hobby); se retira el cron `monthly-podium`. El juego diario NO cambia; el tema es una disciplina de curación del calendario (Fase 1 manual; auto-tagging es roadmap fuera de este plan).

**Tech Stack:** React 18 (JSX), Vite, Supabase (Postgres + RLS + RPC SECURITY DEFINER), Vercel Functions (Node) + Vercel Cron, Vitest (node).

**Spec:** `docs/superpowers/specs/2026-07-12-temporadas-tematicas-design.md`

---

## Estrategia de fases (un PR por fase)

- **Fase 1 — Backbone (SQL + cron), INVISIBLE al jugador.** Rama `claude/temporadas-fase-1`. Aditiva: crea `seasons`/`season_podium` y las funciones, y engancha el cierre en `warm-daily`. El mensual sigue vivo; nada cambia de cara al usuario. Al final se crea la **Temporada 1** (INSERT en Supabase) para que exista una activa antes del flip.
- **Fase 2 — El flip, VISIBLE.** Rama `claude/temporadas-fase-2`. Reapunta `snapshot_daily_ranks` y todo el frontend al scope de temporada; modal de vista única + banner + countdown; Leyendas al perfil; retira el cron mensual. **Requiere Fase 1 mergeada y una temporada activa creada.**
- **Fase 3 — Editor de temporadas (admin) + ventana de calendario.** Rama `claude/temporadas-fase-3`. Quita el toil del INSERT manual y amplía la ventana de `schedule.js` para curar 2 semanas. Independiente; se puede posponer.

**Fuera de este plan (roadmap, ver spec):** pool automático por tema (taggear `cars` + `pick_daily_car` season-aware) y relajar el no-repeat con cooldown (Decisión D).

---

## Notas de entorno (léelas antes de empezar)

1. **`vitest`, no `npm run build`.** El build local se rompe en este worktree (vite 8/rolldown en Windows); la red de seguridad es `npx vitest run`. El build real lo valida el Preview de Vercel.
2. **El SQL se aplica A MANO en el SQL editor de Supabase** (no hay migraciones automáticas). Los scripts son idempotentes. La cobertura de seguridad la dan `test:rls`/`test:attacks`.
3. **Límite de 2 cron jobs (Hobby).** El cierre de temporada NO es un cron nuevo: va piggyback en `warm-daily`. Se retira `monthly-podium` (libera slot).
4. **Comentarios en español explicando el porqué** (convención del repo). UTF-8 correcto; nunca metas no-ASCII en char-classes de regex (regla 14 de CLAUDE.md).
5. **No diverjas del cálculo de puntos** de `scripts/supabase-monthly-ranking.sql` sin sincronizar: `get_season_leaderboard` es su espejo.
6. **Commits frecuentes, uno por tarea.**

---

# FASE 1 — Backbone (SQL + cron)

## Estructura de ficheros (Fase 1)

**Nuevos:**
- `scripts/2026-07-temporadas.sql` — tablas `seasons`/`season_podium`, `current_season`, `get_season_leaderboard`, `get_my_season_rank`, `compute_season_podium`, `close_finished_seasons`.

**Modificados:**
- `api/_lib/cron/warm-daily.js` — nuevo PASO 6: `close_finished_seasons()`.

---

## F1·Task 1: Migración SQL de temporadas

**Files:**
- Create: `scripts/2026-07-temporadas.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- scripts/2026-07-temporadas.sql
-- TEMPORADAS TEMÁTICAS: reemplazan el ranking mensual por ciclos cortos (1-2 sem)
-- con temática. Es el mensual GENERALIZADO: misma derivación de puntos base, solo
-- que los límites salen de la fila `seasons` en vez de date_trunc('month'). Espejo
-- de scripts/supabase-monthly-ranking.sql — NO diverjas del cálculo de puntos sin
-- sincronizar ambos.
--
-- FASE 1 es ADITIVA: crea tablas y funciones nuevas SIN tocar el mensual ni
-- snapshot_daily_ranks (el "flip" va en la Fase 2). Aplicar en el SQL editor de
-- Supabase. Idempotente (CREATE OR REPLACE / IF NOT EXISTS).

-- ============================================================================
-- 0) Extensión para el constraint de no-solape (rangos GiST)
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================================
-- 1) TABLA seasons — fuente de verdad de la temporada activa
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.seasons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number     int  NOT NULL,               -- "Temporada 7" (display)
  label_es   text NOT NULL,               -- "Grupo B", "Coches de carreras"
  label_en   text NOT NULL,               -- "Group B", "Racing cars"
  starts_at  date NOT NULL,               -- inclusivo, calendario Madrid
  ends_at    date NOT NULL,               -- inclusivo, calendario Madrid
  closed_at  timestamptz,                 -- lo sella close_finished_seasons()
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seasons_range_ok CHECK (ends_at >= starts_at)
);

-- No dos temporadas solapadas → current_season() siempre única. Si tu proyecto
-- no permite el constraint gist, quítalo y valida el no-solape en el editor
-- admin (Fase 3).
ALTER TABLE public.seasons DROP CONSTRAINT IF EXISTS seasons_no_overlap;
ALTER TABLE public.seasons
  ADD CONSTRAINT seasons_no_overlap
  EXCLUDE USING gist (daterange(starts_at, ends_at, '[]') WITH &&);

-- Público: el tema y las fechas son el gancho de marketing (banner + countdown).
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS seasons_read ON public.seasons;
CREATE POLICY seasons_read ON public.seasons FOR SELECT USING (true);
REVOKE ALL ON public.seasons FROM anon, authenticated;
GRANT SELECT ON public.seasons TO anon, authenticated;

-- ============================================================================
-- 2) current_season() — la temporada que contiene HOY (Madrid)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_season()
RETURNS public.seasons
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT * FROM public.seasons
  WHERE (now() AT TIME ZONE 'Europe/Madrid')::date BETWEEN starts_at AND ends_at
  ORDER BY starts_at DESC
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.current_season() TO anon, authenticated;

-- ============================================================================
-- 3) get_season_leaderboard(p_season_id, p_limit) — el mensual generalizado
-- ============================================================================
-- Espejo EXACTO de get_monthly_leaderboard salvo los límites: [starts_at, ends_at]
-- de la temporada (ambos inclusivos) en vez del mes. p_season_id NULL →
-- current_season(). Mismo set de columnas para reutilizar el render de filas.
DROP FUNCTION IF EXISTS public.get_season_leaderboard(uuid, int);
CREATE OR REPLACE FUNCTION public.get_season_leaderboard(
  p_season_id uuid DEFAULT NULL,
  p_limit int DEFAULT 1000
)
RETURNS TABLE (
  rank int, user_id uuid, display_name text,
  current_streak int, max_streak int, last_played_date date,
  total_wins int, total_points int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH s AS (
    SELECT * FROM public.seasons
    WHERE id = COALESCE(p_season_id, (SELECT id FROM public.current_season()))
  ),
  scored AS (
    SELECT
      ug.user_id,
      CASE jsonb_array_length(ug.guesses::jsonb)
        WHEN 1 THEN 10 WHEN 2 THEN 6 WHEN 3 THEN 4
        WHEN 4 THEN 3  WHEN 5 THEN 2 WHEN 6 THEN 1 ELSE 0
      END AS base,
      EXISTS (
        SELECT 1 FROM public.daily_cars dc
        WHERE dc.date = ug.date AND dc.car_id = ug.car_id
      ) AS is_daily,
      ug.date AS won_date
    FROM public.user_guesses ug, s
    WHERE ug.status = 'won'
      AND ug.date >= s.starts_at
      AND ug.date <= s.ends_at            -- ends_at INCLUSIVO
  ),
  agg AS (
    SELECT s2.user_id,
      SUM(CASE WHEN s2.is_daily THEN s2.base ELSE CEIL(s2.base/2.0) END)::int AS points,
      COUNT(*)::int AS wins,
      MAX(s2.won_date) AS last_win_date
    FROM scored s2
    GROUP BY s2.user_id
    HAVING SUM(CASE WHEN s2.is_daily THEN s2.base ELSE CEIL(s2.base/2.0) END) > 0
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY a.points DESC, a.last_win_date ASC, a.user_id)::int AS rank,
    a.user_id, p.display_name,
    COALESCE(st.current_streak,0)::int, COALESCE(st.max_streak,0)::int,
    st.last_played_date, a.wins, a.points
  FROM agg a
  JOIN public.profiles p ON p.id = a.user_id
  LEFT JOIN public.stats st ON st.user_id = a.user_id
  WHERE p.display_name IS NOT NULL AND p.display_name <> ''
  ORDER BY rank
  LIMIT GREATEST(1, COALESCE(p_limit, 1000));
$$;
REVOKE ALL ON FUNCTION public.get_season_leaderboard(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_season_leaderboard(uuid, int) TO anon, authenticated;

-- ============================================================================
-- 4) get_my_season_rank(p_user_id, p_season_id) — mi puesto + movimiento vs ayer
-- ============================================================================
-- Espejo de get_my_monthly_rank: rank + total + prev_rank + delta. prev_rank sale
-- de rank_snapshots (lo sella snapshot_daily_ranks; en Fase 2 ese snapshot pasa a
-- ser de temporada). delta > 0 = ha subido.
DROP FUNCTION IF EXISTS public.get_my_season_rank(uuid, uuid);
CREATE OR REPLACE FUNCTION public.get_my_season_rank(
  p_user_id uuid,
  p_season_id uuid DEFAULT NULL
)
RETURNS TABLE (rank int, total int, prev_rank int, delta int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH lb AS (
    SELECT slb.rank, slb.user_id
    FROM public.get_season_leaderboard(p_season_id, 1000000) slb
  ),
  me AS (
    SELECT
      (SELECT lb.rank FROM lb WHERE lb.user_id = p_user_id)::int AS rank,
      (SELECT count(*) FROM lb)::int AS total
  ),
  prev AS (
    SELECT rs.rank AS prev_rank
    FROM public.rank_snapshots rs
    WHERE rs.user_id = p_user_id
      AND rs.day = (now() AT TIME ZONE 'Europe/Madrid')::date
    LIMIT 1
  )
  SELECT me.rank, me.total, prev.prev_rank,
    CASE WHEN me.rank IS NOT NULL AND prev.prev_rank IS NOT NULL
         THEN prev.prev_rank - me.rank ELSE NULL END AS delta
  FROM me LEFT JOIN prev ON true;
$$;
REVOKE ALL ON FUNCTION public.get_my_season_rank(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_season_rank(uuid, uuid) TO anon, authenticated;

-- ============================================================================
-- 5) season_podium (clon de monthly_podium) + compute + close
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.season_podium (
  season_id  uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  rank       int  NOT NULL CHECK (rank BETWEEN 1 AND 3),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  points     int  NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, rank)
);
CREATE INDEX IF NOT EXISTS season_podium_user_idx ON public.season_podium (user_id);
ALTER TABLE public.season_podium ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS season_podium_read ON public.season_podium;
CREATE POLICY season_podium_read ON public.season_podium FOR SELECT USING (true);
REVOKE ALL ON public.season_podium FROM anon, authenticated;
GRANT SELECT ON public.season_podium TO anon, authenticated;

-- Calcula y persiste el podio de una temporada. Idempotente (borra+reinserta).
-- Umbral anti "campeón de temporada vacía": < p_min_players rankeados → 0 medallas.
CREATE OR REPLACE FUNCTION public.compute_season_podium(
  p_season_id uuid, p_min_players int DEFAULT 5
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_players int; v_written int := 0;
BEGIN
  SELECT count(*) INTO v_players FROM public.get_season_leaderboard(p_season_id, 1000000);
  DELETE FROM public.season_podium WHERE season_id = p_season_id;
  IF v_players < p_min_players THEN RETURN 0; END IF;
  INSERT INTO public.season_podium (season_id, rank, user_id, points)
  SELECT p_season_id, lb.rank, lb.user_id, lb.total_points
  FROM public.get_season_leaderboard(p_season_id, 3) lb WHERE lb.rank <= 3;
  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written;
END; $$;

-- Cierra TODAS las temporadas ya terminadas y sin sellar. `closed_at` evita
-- recomputar en bucle una temporada sub-umbral (0 medallas): se marca cerrada
-- aunque no otorgue podio. Robusto a que el cron falle un día (recoge pendientes).
-- La llama warm-daily (PASO 6). Cadencia variable resuelta con un chequeo diario,
-- SIN cron nuevo (límite de 2 en Hobby).
CREATE OR REPLACE FUNCTION public.close_finished_seasons()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Madrid')::date;
  r record; v_count int := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.seasons WHERE ends_at < v_today AND closed_at IS NULL
  LOOP
    PERFORM public.compute_season_podium(r.id, 5);
    UPDATE public.seasons SET closed_at = now() WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $$;

REVOKE ALL ON FUNCTION public.compute_season_podium(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_finished_seasons()        FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_finished_seasons() TO service_role;
```

- [ ] **Step 2: Commit** (el SQL lo aplica el usuario en Supabase; ver F1·Task 3)

```bash
git add scripts/2026-07-temporadas.sql
git commit -m "feat(db): temporadas — tablas, leaderboard, podio y cierre (aditivo)"
```

---

## F1·Task 2: Cierre de temporada piggyback en `warm-daily` (PASO 6)

**Files:**
- Modify: `api/_lib/cron/warm-daily.js`

- [ ] **Step 1: Añadir el PASO 6 tras el PASO 5**

En `api/_lib/cron/warm-daily.js`, localiza el final del bloque `// ---- PASO 5: sellar la clasificación del día …` (el `try/catch` que llama a `snapshot_daily_ranks`, termina sobre la línea `}` previa a `result.ok = true;`). JUSTO DESPUÉS de ese `catch {…}` y ANTES de `result.ok = true;`, inserta:

```jsx
    // ---- PASO 6: cerrar temporadas terminadas (Salón de la Fama) ---------
    // Piggyback best-effort, mismo motivo que PASO 4/5 (límite de 2 crons en
    // Hobby): un chequeo diario "¿cerró ayer alguna temporada?" congela su
    // podio en season_podium. Idempotente (close_finished_seasons salta las ya
    // selladas vía closed_at). Un fallo aquí no afecta al warming. Ver
    // scripts/2026-07-temporadas.sql.
    const step6Start = Date.now();
    try {
      const supabaseAdmin = getSupabaseAdmin();
      if (!supabaseAdmin) {
        result.steps.push({ step: "close-seasons", skipped: true, reason: "admin envs ausentes" });
      } else {
        const { data, error } = await supabaseAdmin.rpc("close_finished_seasons");
        result.steps.push({
          step: "close-seasons",
          ms: Date.now() - step6Start,
          ...(error
            ? { ok: false, error: error.message || "RPC failed" }
            : { ok: true, seasonsClosed: typeof data === "number" ? data : data ?? null }),
        });
      }
    } catch (err) {
      result.steps.push({
        step: "close-seasons",
        ms: Date.now() - step6Start,
        ok: false,
        error: err?.message || "uncaught",
      });
    }
```

- [ ] **Step 2: Verificar que la suite sigue verde**

Run: `npx vitest run`
Expected: PASS (ningún test importa warm-daily; confirma que no rompimos imports).

- [ ] **Step 3: Commit**

```bash
git add api/_lib/cron/warm-daily.js
git commit -m "feat(cron): warm-daily cierra temporadas terminadas (PASO 6, piggyback)"
```

---

## F1·Task 3: Aplicar SQL, crear la Temporada 1 y verificar (Supabase)

**Files:** ninguno (operación manual del usuario en Supabase).

- [ ] **Step 1: Aplicar la migración**

El usuario ejecuta `scripts/2026-07-temporadas.sql` completo en el SQL editor de Supabase.

- [ ] **Step 2: Crear la primera temporada (INSERT)**

Ejemplo (ajusta fechas/tema; **contiguas**: la siguiente empieza el día después de `ends_at`):

```sql
INSERT INTO public.seasons (number, label_es, label_en, starts_at, ends_at)
VALUES (1, 'Coches de carreras', 'Racing cars', '2026-07-20', '2026-08-02');
```

- [ ] **Step 3: Verificar (read-only)**

```sql
SELECT * FROM public.current_season();               -- debe devolver la Temporada 1
SELECT * FROM public.get_season_leaderboard(NULL, 10); -- filas si ya hay victorias en el rango
```

Nota: el mensual sigue funcionando en paralelo; nada cambió de cara al usuario. El *flip* es la Fase 2.

- [ ] **Step 4: Push y PR de Fase 1**

```bash
git push -u origin claude/temporadas-fase-1
gh pr create --base main --head claude/temporadas-fase-1 \
  --title "feat(temporadas): backbone (SQL + cierre en warm-daily)" \
  --body "Fase 1 del spec docs/superpowers/specs/2026-07-12-temporadas-tematicas-design.md. Aditiva e invisible: crea seasons/season_podium y funciones, y engancha close_finished_seasons en warm-daily. Requiere aplicar scripts/2026-07-temporadas.sql en Supabase y crear la Temporada 1."
```

---

## Self-review Fase 1

- `seasons`/`season_podium` públicos de lectura, escritura solo definer/service → F1·T1. ✓
- `get_season_leaderboard` = espejo del mensual (mismo cálculo) → F1·T1. ✓
- Cierre variable sin cron nuevo (piggyback + `closed_at`) → F1·T1 + F1·T2. ✓
- Aditivo: no toca el mensual ni snapshot_daily_ranks → F1·T1. ✓
- Temporada activa creada antes del flip → F1·T3. ✓

---

# FASE 2 — El flip (visible)

## Estructura de ficheros (Fase 2)

**Nuevos:**
- `src/lib/season.js` (+ `src/lib/season.test.js`) — lógica pura del countdown.
- `src/components/Legends.jsx` — leaderboard histórico (all-time) para el perfil.
- `scripts/2026-07-temporadas-flip.sql` — ALTER de `snapshot_daily_ranks` a scope temporada.

**Modificados:**
- `src/lib/statsService.js` — funciones de temporada (+ `getCurrentSeason`, `getSeasonMedals`).
- `src/components/Ranking.jsx` — vista única + banner + countdown (fuera pestañas).
- `src/components/configurator/RankParte.jsx` — scope temporada + countdown.
- `src/App.jsx`, `src/hooks/useAuthSession.js` — píldora del header a `getMySeasonRank`.
- `src/components/PodiumMedals.jsx` — medallas de temporada + legado mensual.
- `src/components/MyStats.jsx` — puerta "Leyendas".
- `vercel.json` + `api/cron/[...job].js` — retirar el cron `monthly-podium`.
- `src/i18n/locales/es.json`, `en.json` — claves de temporada/countdown/Leyendas.
- `PRODUCT.md` — rankings mensual → temporadas.

---

## F2·Task 1: ALTER `snapshot_daily_ranks` → scope temporada (SQL)

**Files:**
- Create: `scripts/2026-07-temporadas-flip.sql`

- [ ] **Step 1: Escribir el ALTER**

```sql
-- scripts/2026-07-temporadas-flip.sql
-- FASE 2: reapunta el snapshot del "movimiento vs ayer" al leaderboard de
-- TEMPORADA (antes mensual). Única línea que cambia respecto a
-- scripts/supabase-rank-movement.sql: la fuente del snapshot. rank_snapshots
-- (day, user_id) se reutiliza intacta — el día 1 de una temporada nueva el
-- leaderboard está vacío → snapshot vacío → prev_rank NULL → copy neutro
-- ("estrenas puesto"). Reset correcto sin código extra. Aplicar en Supabase.
CREATE OR REPLACE FUNCTION public.snapshot_daily_ranks()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_day date := (now() AT TIME ZONE 'Europe/Madrid')::date; v_n int;
BEGIN
  DELETE FROM public.rank_snapshots WHERE day = v_day;
  INSERT INTO public.rank_snapshots (day, user_id, rank)
  SELECT v_day, lb.user_id, lb.rank
  FROM public.get_season_leaderboard(NULL, 1000000) lb;   -- ← antes get_monthly_leaderboard
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END; $$;
```

- [ ] **Step 2: Commit** (se aplica en Supabase en F2·Task 11)

```bash
git add scripts/2026-07-temporadas-flip.sql
git commit -m "feat(db): snapshot diario de ranks pasa a scope temporada"
```

---

## F2·Task 2: `src/lib/season.js` — countdown (lógica pura, TDD)

**Files:**
- Create: `src/lib/season.js`
- Test: `src/lib/season.test.js`

- [ ] **Step 1: Escribir el test que falla**

```js
// src/lib/season.test.js
import { describe, it, expect } from "vitest";
import { daysUntilClose } from "./season";

// today fijo (Madrid) construido desde una fecha UTC dentro del día 2026-07-25.
const today = new Date("2026-07-25T09:00:00Z");

describe("daysUntilClose", () => {
  it("ends_at hoy → 0 (cierra hoy)", () => {
    expect(daysUntilClose("2026-07-25", today)).toBe(0);
  });
  it("ends_at mañana → 1", () => {
    expect(daysUntilClose("2026-07-26", today)).toBe(1);
  });
  it("ends_at dentro de 5 días → 5", () => {
    expect(daysUntilClose("2026-07-30", today)).toBe(5);
  });
  it("ends_at pasado → negativo", () => {
    expect(daysUntilClose("2026-07-24", today)).toBe(-1);
  });
  it("entrada inválida → null", () => {
    expect(daysUntilClose("", today)).toBe(null);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `npx vitest run src/lib/season.test.js`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/lib/season.js`**

```js
// src/lib/season.js
// Lógica PURA de temporada: días que faltan para el cierre (countdown del banner
// del ranking y del parte). Todo en fecha "calendario" de Madrid, sin horas —
// como el resto del ranking (el coche cambia a medianoche de Madrid).

// Devuelve ends_at - hoy en días de calendario. 0 = cierra hoy; 1 = mañana;
// negativo = ya cerró; null si la entrada no es una fecha válida.
export function daysUntilClose(endsAt, today = new Date()) {
  if (!endsAt || typeof endsAt !== "string") return null;
  const end = Date.parse(`${endsAt}T00:00:00Z`);
  if (Number.isNaN(end)) return null;
  // "hoy" en Madrid como YYYY-MM-DD → UTC midnight para restar días completos.
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(today);
  const now = Date.parse(`${todayStr}T00:00:00Z`);
  if (Number.isNaN(now)) return null;
  return Math.round((end - now) / 86400000);
}
```

- [ ] **Step 4: Ejecutar y ver pasar**

Run: `npx vitest run src/lib/season.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/season.js src/lib/season.test.js
git commit -m "feat(temporadas): lógica pura del countdown de cierre"
```

---

## F2·Task 3: `statsService` — funciones de temporada

**Files:**
- Modify: `src/lib/statsService.js`

- [ ] **Step 1: Añadir las nuevas funciones**

Al final de `src/lib/statsService.js`, añade (junto a las de leaderboard):

```js
// Fecha 'YYYY-MM-DD' en Madrid (misma que usa el ranking).
function todayMadridStr() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

// Temporada activa (o null si hay hueco). Lectura pública directa de `seasons`.
// La usa el banner del modal + el parte (label + countdown).
export async function getCurrentSeason() {
  const today = todayMadridStr();
  const { data, error } = await supabase
    .from("seasons")
    .select("id, number, label_es, label_en, starts_at, ends_at")
    .lte("starts_at", today)
    .gte("ends_at", today)
    .maybeSingle();
  if (error) { console.error("[getCurrentSeason]", error); return null; }
  return data;
}

// Leaderboard de la temporada en curso. Mismo shape que getMonthlyLeaderboard
// (Ranking.jsx reutiliza el render de filas). p_season_id NULL → current_season().
export async function getSeasonLeaderboard() {
  const { data, error } = await supabase.rpc("get_season_leaderboard", {
    p_season_id: null, p_limit: 1000,
  });
  if (error) throw error;
  return (data || []).map((row) => ({
    rank: row.rank,
    userId: row.user_id,
    displayName: row.display_name,
    currentStreak: isStreakAlive(row.last_played_date) ? row.current_streak || 0 : 0,
    maxStreak: row.max_streak || 0,
    totalWins: row.total_wins || 0,
    totalPoints: row.total_points || 0,
  }));
}

// Mi puesto en la temporada (+ movimiento vs ayer) para la píldora y el parte.
// Mismo shape que getMyMonthlyRank: { rank, total, delta, isNew } | null.
export async function getMySeasonRank(userId) {
  if (!userId) return null;
  const { data, error } = await supabase.rpc("get_my_season_rank", {
    p_user_id: userId, p_season_id: null,
  });
  if (error) { console.error("[getMySeasonRank]", error); return null; }
  const row = Array.isArray(data) ? data[0] : data;
  const rank = row?.rank ?? null;
  if (!rank || rank < 1) return null;
  const prevRank = row?.prev_rank ?? null;
  return { rank, total: row?.total ?? null, delta: row?.delta ?? null, isNew: prevRank == null };
}

// Medallas de temporada (top 1/2/3 de temporadas cerradas) + su tema, para la
// vitrina del perfil. Lee season_podium (público) join seasons por el label.
export async function getSeasonMedals(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from("season_podium")
    .select("rank, points, seasons(number, label_es, label_en, ends_at)")
    .eq("user_id", userId)
    .order("season_id", { ascending: false });
  if (error) { console.error("[getSeasonMedals]", error); return []; }
  return (data || []).map((row) => ({
    rank: row.rank,
    points: row.points,
    number: row.seasons?.number ?? null,
    labelEs: row.seasons?.label_es ?? null,
    labelEn: row.seasons?.label_en ?? null,
    endsAt: row.seasons?.ends_at ?? null,
  }));
}
```

- [ ] **Step 2: Repuntar `getProfileSummary` a la temporada**

En `getProfileSummary` (≈línea 269), cambia:

```js
    getMyMonthlyRank(base.user.id),
```
por:
```js
    getMySeasonRank(base.user.id),
```

- [ ] **Step 3: Retirar las funciones mensuales ya sin uso**

Borra `getMonthlyLeaderboard` y `getMyMonthlyRank` (sus consumidores se repuntan en F2·T4/T5/T6). **CONSERVA `getMonthlyMedals`** (medallas de mes de legado, Decisión C). Verifica que no quedan referencias:

Run: `grep -rn "getMonthlyLeaderboard\|getMyMonthlyRank" src/`
Expected: 0 resultados tras completar F2·T4/T5.

- [ ] **Step 4: Verificar suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/statsService.js
git commit -m "feat(temporadas): statsService — leaderboard/rank/medallas/temporada activa"
```

---

## F2·Task 4: `Ranking.jsx` — vista única + banner + countdown

**Files:**
- Modify: `src/components/Ranking.jsx`

**Contexto:** hoy el modal tiene conmutador `month`/`all`. Se elimina: pasa a **una sola vista** (temporada) con un banner (número + tema + countdown). El histórico all-time sale de aquí (va al perfil, F2·T7).

- [ ] **Step 1: Imports**

Cambia la línea 2:
```js
import { getLeaderboard, getMonthlyLeaderboard } from "../lib/statsService";
```
por:
```js
import { getSeasonLeaderboard, getCurrentSeason } from "../lib/statsService";
import { daysUntilClose } from "../lib/season";
```

- [ ] **Step 2: Estado — quitar `tab`, añadir `season`**

Sustituye el `const [tab, setTab] = useState("month");` por:
```js
const [season, setSeason] = useState(null);
```
Elimina el `useEffect` que resetea `tab` al cerrar (líneas ~118-120).

- [ ] **Step 3: Fetch — siempre temporada + la temporada activa**

Reemplaza el `useEffect` de carga (el que usa `const fetcher = tab === "month" ? …`) por uno que cargue en paralelo el leaderboard de temporada y la temporada activa:

```js
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ loading: true, players: [], error: "" });
    Promise.all([getSeasonLeaderboard(), getCurrentSeason()])
      .then(([players, s]) => {
        if (cancelled) return;
        setSeason(s);
        setState({ loading: false, players, error: "" });
      })
      .catch((err) => {
        console.error("[Ranking] fallo cargando temporada", err);
        if (!cancelled) setState({ loading: false, players: [], error: t("ranking.errorLoad") });
      });
    return () => { cancelled = true; };
  }, [open]);
```

- [ ] **Step 4: Banner de temporada (sustituye el switcher de pestañas)**

Elimina el bloque `role="tablist"` completo (el `<div>` con los dos botones `month`/`all`, líneas ~183-214). En su lugar, bajo el `<h2>` del título, pon el banner. Usa `tn` para el plural del countdown (patrón ya usado en RankParte):

```jsx
        {season && (() => {
          const d = daysUntilClose(season.ends_at);
          const label = dateLocale?.startsWith?.("en") ? season.label_en : season.label_es;
          return (
            <div className="mb-4 rounded-xl border border-gold/40 bg-gold/[0.06] px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gold/80">
                    {t("ranking.seasonKicker", { n: season.number })}
                  </p>
                  <p className="truncate text-lg font-semibold text-foreground">{label}</p>
                </div>
                <span className="shrink-0 rounded-full border border-gold/40 px-2.5 py-1 text-[11px] font-semibold text-gold">
                  {d <= 0 ? t("ranking.closesToday") : tn("ranking.closesIn", d)}
                </span>
              </div>
            </div>
          );
        })()}
```

Asegúrate de tener `tn` en el `useT()` del componente: `const { t, tn, dateLocale } = useT();`.

- [ ] **Step 5: Subtítulo de fila — siempre "victorias de la temporada"**

En las dos filas (la del map y la de `selfRow`), sustituye el ternario:
```jsx
{tab === "month" ? t("ranking.monthWins", { value: player.totalWins }) : t("ranking.bestStreak", { value: player.maxStreak })}
```
por:
```jsx
{t("ranking.seasonWins", { value: player.totalWins })}
```
(igual para `selfRow.totalWins`). El color oro del puesto #1 y el resto del render de filas NO cambian.

- [ ] **Step 6: Empty state**

Cambia el `tab === "month" ? t("ranking.emptyMonth") : t("ranking.empty")` por `t("ranking.emptySeason")`.

- [ ] **Step 7: Verificar suite**

Run: `npx vitest run`
Expected: PASS (no hay test de Ranking; confirma imports).

- [ ] **Step 8: Commit**

```bash
git add src/components/Ranking.jsx
git commit -m "feat(temporadas): modal de ranking a vista única con banner + countdown"
```

---

## F2·Task 5: `RankParte.jsx` + píldora del header → temporada

**Files:**
- Modify: `src/components/configurator/RankParte.jsx`
- Modify: `src/App.jsx`
- Modify: `src/hooks/useAuthSession.js`

- [ ] **Step 1: Píldora del header (App.jsx + useAuthSession.js)**

En `src/App.jsx` (imports ~línea 10 y uso ~línea 288) y `src/hooks/useAuthSession.js` (import ~línea 13 y uso ~línea 68), sustituye `getMyMonthlyRank` por `getMySeasonRank`:

Run para localizar los puntos exactos:
`grep -n "getMyMonthlyRank" src/App.jsx src/hooks/useAuthSession.js`

Cambia el import y la llamada en ambos ficheros. El shape de retorno es idéntico, así que el resto no se toca.

- [ ] **Step 2: `RankParte.jsx` — ladillo de temporada + countdown**

El componente recibe `rank` (ahora de temporada, ya repuntado en App.jsx). Sustituye la construcción del mes por la temporada activa. Añade props/import:

```jsx
import { daysUntilClose } from "../../lib/season";
```

Cambia el ladillo del mes (las líneas que calculan `rawMonth`/`month` y el `t("parte.kicker") · {month}`) por el label + countdown de la temporada. Pásale la temporada como prop desde el EndScreen (que ya la puede obtener de `getCurrentSeason`, o reutiliza la que App.jsx cargó). Estructura del ladillo:

```jsx
  const label = dateLocale?.startsWith?.("en") ? season?.label_en : season?.label_es;
  const d = season ? daysUntilClose(season.ends_at) : null;
  // ...
  <div className="cdd-parte-lad">
    {label || t("parte.kicker")}
    {d != null && <span> · {d <= 0 ? t("parte.closesToday") : tn("parte.closesIn", d)}</span>}
  </div>
```

Mantén intactos `rankMovement(rank)` y las variantes up/down/hold/new/unranked: el movimiento vs ayer funciona igual, solo cambia el scope de los datos.

- [ ] **Step 3: Verificar suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx src/hooks/useAuthSession.js src/components/configurator/RankParte.jsx
git commit -m "feat(temporadas): parte y píldora del header al puesto de temporada"
```

---

## F2·Task 6: `PodiumMedals.jsx` — medallas de temporada + legado mensual

**Files:**
- Modify: `src/components/PodiumMedals.jsx`

**Contexto (Decisión C):** las medallas mensuales ya ganadas se **preservan como legado**. La vitrina muestra las de temporada (tema) y, debajo, las de mes históricas.

- [ ] **Step 1: Cargar ambas fuentes**

En `src/components/PodiumMedals.jsx`, importa también `getSeasonMedals` y cárgala junto a `getMonthlyMedals`:

```js
import { getSeasonMedals, getMonthlyMedals } from "../lib/statsService";
// ...
const [season, monthly] = await Promise.all([
  getSeasonMedals(userId),
  getMonthlyMedals(userId),
]);
```

- [ ] **Step 2: Render**

Pinta primero las medallas de temporada (etiqueta = tema `labelEs`/`labelEn` según locale, ej. "🏆 Campeón · Grupo B"), y debajo, si `monthly.length > 0`, una sección "De mes (legado)" con las mensuales tal como se pintaban. Reutiliza los tonos oro/plata/bronce (`TIER_HEX`) ya usados.

- [ ] **Step 3: Verificar suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/PodiumMedals.jsx
git commit -m "feat(temporadas): vitrina de medallas de temporada + legado mensual"
```

---

## F2·Task 7: "Leyendas" (histórico all-time) en el perfil

**Files:**
- Create: `src/components/Legends.jsx`
- Modify: `src/components/MyStats.jsx`

- [ ] **Step 1: Componente `Legends.jsx` (reusa `getLeaderboard`)**

Modal/sección ligera que lista el histórico all-time (`getLeaderboard`, que ya existe y lee el acumulado `stats.total_points`, incluye bonus de racha). Reutiliza el patrón de fila de `Ranking.jsx` (puesto oro/plata/bronce + nombre + puntos). Cabecera: `t("ranking.legends")` / `t("ranking.legendsSubtitle")`.

- [ ] **Step 2: Puerta en `MyStats.jsx`**

Añade una entrada "Leyendas" en el carnet/puertas del perfil que abra `Legends`. Localiza el grupo de puertas existente:

Run: `grep -n "puerta\|Garaje\|Logros\|onOpen" src/components/MyStats.jsx`

Inserta la puerta "Leyendas" junto a las de Garaje/Logros, con su icono, abriendo el modal `Legends`.

- [ ] **Step 3: Verificar suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/Legends.jsx src/components/MyStats.jsx
git commit -m "feat(temporadas): Leyendas (histórico all-time) accesible desde el perfil"
```

---

## F2·Task 8: Retirar el cron `monthly-podium`

**Files:**
- Modify: `vercel.json`
- Modify: `api/cron/[...job].js`
- Delete: `api/_lib/cron/monthly-podium.js` (opcional, limpieza)

- [ ] **Step 1: Quitar el cron de `vercel.json`**

En `vercel.json`, elimina del array `"crons"` el objeto de `/api/cron/monthly-podium` (queda solo `warm-daily`). Las temporadas ya no usan cadencia mensual; el cierre va en warm-daily.

- [ ] **Step 2: Quitar la ruta del dispatcher**

En `api/cron/[...job].js`, elimina el import de `monthlyPodium` y su entrada en `JOBS`. (Deja `warm-daily` y `send-push`.)

- [ ] **Step 3: (Opcional) borrar el handler huérfano**

```bash
git rm api/_lib/cron/monthly-podium.js
```
Las funciones SQL `compute_monthly_podium`/`snapshot_previous_month_podium` se dejan en Supabase (idempotentes, inertes); `monthly_podium` se conserva para las medallas de legado.

- [ ] **Step 4: Verificar suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vercel.json api/cron/[...job].js
git commit -m "chore(cron): retira monthly-podium (temporadas cierran en warm-daily)"
```

---

## F2·Task 9: i18n — claves de temporada / countdown / Leyendas

**Files:**
- Modify: `src/i18n/locales/es.json`, `src/i18n/locales/en.json`

- [ ] **Step 1: Añadir claves en el bloque `"ranking"` (es.json)**

Añade (y **elimina** las obsoletas `tabMonth`, `tabAll`, `emptyMonth`, `monthWins`, `bestStreak` si ya no se referencian — verifícalo con grep):

```json
    "seasonKicker": "Temporada {n}",
    "closesToday": "Cierra hoy",
    "closesIn_one": "Cierra en {count} día",
    "closesIn_other": "Cierra en {count} días",
    "seasonWins": "{value} victorias",
    "emptySeason": "Aún no hay marcas esta temporada. ¡Sé el primero!",
    "legends": "Leyendas",
    "legendsSubtitle": "Clasificación histórica"
```

- [ ] **Step 2: Claves del parte (bloque `"parte"`, es.json)**

```json
    "closesToday": "cierra hoy",
    "closesIn_one": "cierra en {count} día",
    "closesIn_other": "cierra en {count} días"
```

- [ ] **Step 3: Mismas claves en `en.json`**

```json
    "seasonKicker": "Season {n}",
    "closesToday": "Closes today",
    "closesIn_one": "Closes in {count} day",
    "closesIn_other": "Closes in {count} days",
    "seasonWins": "{value} wins",
    "emptySeason": "No scores yet this season. Be the first!",
    "legends": "Legends",
    "legendsSubtitle": "All-time ranking"
```
(y en `"parte"`: `closesToday`/`closesIn_one`/`closesIn_other`).

**Nota:** usa el patrón de plural que ya emplea `tn(...)` en el repo (RankParte usa `tn("parte.up", …)`). Ajusta los sufijos `_one`/`_other` al formato real que espere tu helper `tn`.

- [ ] **Step 4: Verificar JSON válido**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/es.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/es.json src/i18n/locales/en.json
git commit -m "i18n(temporadas): claves de temporada, countdown y Leyendas (es/en)"
```

---

## F2·Task 10: `PRODUCT.md`

**Files:**
- Modify: `PRODUCT.md`

- [ ] **Step 1: Actualizar la descripción de rankings**

En la sección "Product Purpose" (y donde se mencione el ranking), reemplaza la idea de ranking mensual/global por **Temporadas Temáticas** + Leyendas + Salón de la Fama. Una o dos frases; coherente con el spec.

- [ ] **Step 2: Commit**

```bash
git add PRODUCT.md
git commit -m "docs(product): rankings pasan a Temporadas Temáticas"
```

---

## F2·Task 11: Verificación en Preview + PR

**Files:** ninguno (verificación).

- [ ] **Step 1: Aplicar el ALTER en Supabase**

El usuario ejecuta `scripts/2026-07-temporadas-flip.sql`. Para probar el movimiento sin esperar al cron, siembra el baseline: `SELECT public.snapshot_daily_ranks();`.

- [ ] **Step 2: Suite completa**

Run: `npx vitest run`
Expected: PASS (incluida `season.test.js`).

- [ ] **Step 3: Push y checklist en el Preview**

```bash
git push -u origin claude/temporadas-fase-2
```

- [ ] Modal de ranking: **una sola vista** (sin pestañas), banner con Temporada N + tema + countdown ("Cierra en X días"), filas correctas.
- [ ] *El parte* (final de partida, logueado): ladillo con el tema + countdown, y movimiento vs ayer.
- [ ] Píldora del header: muestra el puesto de temporada.
- [ ] Perfil: puerta "Leyendas" abre el histórico all-time; vitrina con medallas de temporada (+ legado mensual si las había).
- [ ] Anónimo: el modal se ve informativo (blur + CTA de login) como antes.

- [ ] **Step 4: PR de Fase 2**

Sigue **superpowers:finishing-a-development-branch** para abrir `claude/temporadas-fase-2` → `main`. Requiere haber aplicado `scripts/2026-07-temporadas-flip.sql`. Avisa de que está listo para mergear.

---

## Self-review Fase 2 (cobertura del spec)

- Temporada reemplaza al mensual, modal de vista única → F2·T4. ✓
- Snapshot "vs ayer" a scope temporada → F2·T1. ✓
- Píldora + parte al puesto de temporada + countdown → F2·T2/T5. ✓
- Leyendas (all-time) replegado al perfil → F2·T7. ✓
- Salón de la Fama: medallas de temporada + legado mensual (Decisión C) → F2·T6. ✓
- Retirar cron mensual, cierre en warm-daily → F2·T8 (+ F1·T2). ✓
- i18n sin hardcodear + PRODUCT.md → F2·T9/T10. ✓
- Contiguas (Decisión B) → sin fallback de hueco (no hay UI de "sin temporada"). ✓

---

# FASE 3 — Editor de temporadas (admin) + ventana de calendario

Opcional/posterior: quita el toil del INSERT manual y permite curar 2 semanas de golpe. Rama `claude/temporadas-fase-3`.

## F3·Task 1: API admin de temporadas

**Files:**
- Create: `lib/admin-handlers/seasons.js` (+ ruta en `api/admin/[...slug].js`)

- [ ] CRUD de `seasons` (list / create / update): `number`, `label_es`, `label_en`, `starts_at`, `ends_at`. `requireAdmin` (whitelist email) + `getSupabaseAdmin()` (service_role). Validación de no-solape en servidor (además del constraint gist) devolviendo 409 con mensaje claro. Sigue el patrón de `lib/admin-handlers/schedule.js`.

## F3·Task 2: UI del editor (admin)

**Files:**
- Create: `src/admin/SeasonsPanel.jsx` (+ montaje en `AdminTools.jsx`)

- [ ] Lista de temporadas + form de alta/edición (fechas, tema es/en). Aviso visual si el rango tiene días sin coche programado. Bar de diseño interna (no es cara al usuario).

## F3·Task 3: Ampliar la ventana del calendario

**Files:**
- Modify: `lib/admin-handlers/schedule.js`

- [ ] Subir `DAYS_WINDOW` (hoy 7) para cubrir una temporada de hasta 2 semanas (p.ej. 14). Revisa que `pick_daily_car` idempotente y el swap siguen funcionando en la ventana ampliada. Mostrar a qué temporada pertenece cada día ayuda a curar el tema.

## F3·Task 4: Verificación + PR

- [ ] Crear/editar una temporada desde el admin; confirmar no-solape (409) y que aparece como activa. Push y PR `claude/temporadas-fase-3` → `main`.

## Self-review Fase 3

- Editor CRUD con no-solape → F3·T1/T2. ✓
- Ventana de calendario para 2 semanas → F3·T3. ✓
- Fuera de alcance (roadmap): pool auto por tema, cooldown de no-repeat. ✓
