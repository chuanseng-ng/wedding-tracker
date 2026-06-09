-- Wedding Tracker — schema, integrity constraints, and Row Level Security.
--
-- Run this once for a NEW Supabase project, either in the dashboard SQL editor
-- or via the Supabase CLI (`supabase db push`). It is the authoritative,
-- version-controlled definition of the database — do not rely on copy/pasting
-- ad-hoc SQL from docs.
--
-- The headline security property: data access is granted ONLY to the
-- `authenticated` role. The anonymous role (`anon`) has no policy, so the
-- public anon key alone cannot read, insert, update, or delete any guest data.
-- Helpers must sign in (see README) before the app can touch the database.

create table if not exists public.guests (
  id            uuid primary key default gen_random_uuid(),
  name          text    not null check (char_length(name) between 1 and 120),
  table_number  text    not null default '1' check (char_length(table_number) <= 20),
  checked_in    boolean not null default false,
  checked_in_at timestamptz,
  angbao_given  boolean not null default false,
  angbao_amount numeric not null default 0 check (angbao_amount >= 0 and angbao_amount <= 10000000),
  notes         text    default '' check (char_length(coalesce(notes, '')) <= 500),
  is_vip        boolean not null default false,
  party         text    not null default '' check (party in ('', 'bride', 'groom')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Keep updated_at fresh on every change (audit trail).
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists guests_set_updated_at on public.guests;
create trigger guests_set_updated_at
  before update on public.guests
  for each row execute function public.set_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────
alter table public.guests enable row level security;

-- Remove the legacy wide-open policy if a previous deployment created it.
drop policy if exists "public"          on public.guests;
drop policy if exists "helpers_select"  on public.guests;
drop policy if exists "helpers_insert"  on public.guests;
drop policy if exists "helpers_update"  on public.guests;
drop policy if exists "helpers_delete"  on public.guests;

-- Authenticated helpers (signed in via the shared account) get full access.
-- The `anon` role intentionally has NO policy → denied by default.
create policy "helpers_select" on public.guests
  for select to authenticated using (true);

create policy "helpers_insert" on public.guests
  for insert to authenticated with check (true);

create policy "helpers_update" on public.guests
  for update to authenticated using (true) with check (true);

create policy "helpers_delete" on public.guests
  for delete to authenticated using (true);
