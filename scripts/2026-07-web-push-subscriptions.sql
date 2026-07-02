-- scripts/2026-07-web-push-subscriptions.sql
-- Suscripciones de Web Push (recordatorio diario web). ADMIN-ONLY: el cliente
-- NUNCA toca esta tabla directamente (todo pasa por /api/push/*), así que RLS
-- queda en deny-all para anon/authenticated. Sin GRANT SELECT (regla 3 de
-- CLAUDE.md): no hay lecturas de cliente, luego no hay grants que mantener.
-- La clave natural es `endpoint` (URL de push del navegador): re-suscribir el
-- mismo navegador hace UPSERT, no fila nueva.

create table if not exists public.push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  endpoint         text not null unique,
  p256dh           text not null,          -- subscription.keys.p256dh
  auth             text not null,          -- subscription.keys.auth
  user_id          uuid references auth.users(id) on delete cascade, -- si logueado
  anon_id          text,                   -- id de anon-session (best-effort)
  locale           text not null default 'es',
  created_at       timestamptz not null default now(),
  last_notified_at date,                   -- idempotencia por día
  failure_count    int not null default 0
);

-- Índice para el barrido del cron: "no avisadas hoy".
create index if not exists push_subscriptions_last_notified_idx
  on public.push_subscriptions (last_notified_at);

-- RLS ON, sin políticas => deny-all para anon/authenticated. El service role
-- (getSupabaseAdmin) salta RLS y es el único que la lee/escribe.
alter table public.push_subscriptions enable row level security;

-- Blindaje explícito: revoca cualquier grant heredado a los roles públicos.
revoke all on public.push_subscriptions from anon, authenticated;
