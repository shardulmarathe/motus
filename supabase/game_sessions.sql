-- Run once in Supabase SQL editor (service role uses this table; enable RLS with no public policies).
create table if not exists public.game_sessions (
  id uuid primary key,
  username text not null,
  started_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists game_sessions_username_idx on public.game_sessions (username);

alter table public.game_sessions enable row level security;

grant all on public.game_sessions to service_role;
