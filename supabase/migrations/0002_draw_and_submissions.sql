-- Wedding Tracker — lucky-draw numbers + guest-uploaded ang-bao receipts.
--
-- Run AFTER 0001_init.sql (same place: Supabase SQL editor or `supabase db push`).
-- This migration is idempotent and keeps 0001's security posture: the
-- `authenticated` helper role is the only one that can read/approve anything.
-- The single new public surface is a guest's ability to drop a *pending*
-- ang-bao submission (name + claimed amount + uploaded receipt) for a helper to
-- review — guests can never read, list, or approve submissions or receipts.

-- ── 1. Lucky-draw number on guests ────────────────────────────────────────────
-- A unique, stable raffle number minted when a guest's ang-bao is confirmed.
alter table public.guests
  add column if not exists draw_number int unique;

create sequence if not exists public.draw_number_seq;

-- Atomic, assign-once allocation. Two helpers confirming at the same instant can
-- never collide (the sequence hands out distinct values) and a guest who is
-- toggled off then on again keeps the original number (the update only fires
-- while draw_number is null). SECURITY DEFINER so the sequence is reachable
-- regardless of the caller's grants.
create or replace function public.assign_draw_number(p_guest_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.guests
    set draw_number = nextval('public.draw_number_seq')
    where id = p_guest_id and draw_number is null;
  select draw_number into n from public.guests where id = p_guest_id;
  return n;
end;
$$;

revoke all on function public.assign_draw_number(uuid) from public;
grant execute on function public.assign_draw_number(uuid) to authenticated;

-- ── 2. Guest-upload queue ─────────────────────────────────────────────────────
create table if not exists public.submissions (
  id               uuid primary key default gen_random_uuid(),
  guest_name       text    not null check (char_length(guest_name) between 1 and 120),
  claimed_amount   numeric not null default 0 check (claimed_amount >= 0 and claimed_amount <= 10000000),
  receipt_path     text    not null check (char_length(receipt_path) between 1 and 400),
  status           text    not null default 'pending' check (status in ('pending','approved','rejected')),
  matched_guest_id uuid    references public.guests(id) on delete set null,
  created_at       timestamptz not null default now()
);

alter table public.submissions enable row level security;

drop policy if exists "anon_insert_submission"   on public.submissions;
drop policy if exists "helpers_all_submissions"   on public.submissions;

-- Anonymous guests may ONLY insert a fresh, unmatched, pending row — they cannot
-- read it back, edit it, approve it, or see anyone else's. This is the only
-- public write in the whole app.
create policy "anon_insert_submission" on public.submissions
  for insert to anon
  with check (status = 'pending' and matched_guest_id is null);

-- Signed-in helpers have full review/approve/reject access.
create policy "helpers_all_submissions" on public.submissions
  for all to authenticated
  using (true) with check (true);

-- ── 3. Private receipts bucket ────────────────────────────────────────────────
-- Receipts contain bank details, so the bucket is PRIVATE: guests can upload but
-- never browse, and helpers view each receipt through a short-lived signed URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts', 'receipts', false, 5242880,
  array['image/png','image/jpeg','image/webp','image/heic','image/heif','application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "receipts_anon_insert" on storage.objects;
drop policy if exists "receipts_auth_select" on storage.objects;

-- anon: upload only (no select/list/update/delete).
create policy "receipts_anon_insert" on storage.objects
  for insert to anon
  with check (bucket_id = 'receipts');

-- authenticated helpers: read (needed to mint signed URLs).
create policy "receipts_auth_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts');
