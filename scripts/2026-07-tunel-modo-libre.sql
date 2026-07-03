-- scripts/2026-07-tunel-modo-libre.sql
-- "Túnel de viento": modo libre de rejugado. El usuario re-adivina coches que
-- YA tiene desbloqueados en su garaje, pero desenfocados (blur server-side en
-- /api/car-image mode=g) en lugar del zoom del juego diario. Sin límite diario,
-- sin puntos y sin racha: la recompensa es el distintivo AERO por cromo y los
-- contadores. Diseño completo en api/tunel/start.js.
--
-- Decisiones de datos (el porqué):
--   - El estado de la partida activa NO va en `stats`: stats tiene SELECT
--     público (el ranking lo lee el cliente), y guardar ahí el car_id real
--     del objetivo permitiría cruzarlo con /api/list-cars y ganar al primer
--     intento. Va en una tabla propia deny-all (mismo patrón que
--     push_subscriptions): solo el service_role la toca.
--   - `tunel_games` tiene UNA fila por usuario (PK user_id) que se
--     sobreescribe en cada partida nueva → las derrotas NUNCA acumulan filas
--     (a diferencia de user_guesses, acotada por diseño a wins). El historial
--     agregado vive en los contadores de stats.
--   - `tunel_wins` está acotada por (usuarios × catálogo): la pool excluye lo
--     ya ganado en el túnel, así que hay como máximo una fila por cromo.
--
-- Idempotente (IF NOT EXISTS). Re-ejecutable.

-- ============================================================================
-- [1] Partida activa del túnel (una por usuario, se sobreescribe)
-- ============================================================================
create table if not exists public.tunel_games (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  car_id     uuid not null references public.cars(id) on delete cascade,
  date       date not null,
  guesses    jsonb not null default '[]'::jsonb,
  status     text not null default 'playing'
             check (status in ('playing', 'won', 'lost')),
  updated_at timestamptz not null default now()
);

-- RLS ON sin políticas => deny-all para anon/authenticated. El car_id real del
-- objetivo es EL secreto del juego: ninguna lectura de cliente debe verlo.
alter table public.tunel_games enable row level security;
revoke all on public.tunel_games from anon, authenticated;

-- ============================================================================
-- [2] Victorias del túnel (alimenta el distintivo AERO del garaje)
-- ============================================================================
create table if not exists public.tunel_wins (
  user_id  uuid not null references auth.users(id) on delete cascade,
  car_id   uuid not null references public.cars(id) on delete cascade,
  won_at   date not null,
  attempts int not null,
  primary key (user_id, car_id)
);

-- También deny-all: /api/garage y /api/tunel/* la leen con service_role.
-- Sin lecturas de cliente → sin grants que mantener (regla 3 de CLAUDE.md
-- solo aplica a columnas que el cliente lee vía PostgREST).
alter table public.tunel_wins enable row level security;
revoke all on public.tunel_wins from anon, authenticated;

-- ============================================================================
-- [3] Contadores agregados en stats (públicos, como total_points/total_wins)
-- ============================================================================
-- Solo números: no filtran nada del coche objetivo. Las mutaciones pasan por
-- /api/tunel/validate con service_role (INSERT/UPDATE ya están revocados a
-- authenticated/anon por supabase-hardening.sql [B.3]).
alter table public.stats
  add column if not exists tunel_played int not null default 0,
  add column if not exists tunel_won    int not null default 0;
