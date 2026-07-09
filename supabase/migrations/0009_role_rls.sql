-- 0009_role_rls.sql — Enforce couple vs helper roles at the DB layer.
--
-- The app embeds app_role in JWT user_metadata via supabase.auth.updateUser()
-- immediately after sign-in. Policies here check that claim and restrict
-- destructive or financial operations to the couple account only.
--
-- Threat model: prevents accidental or curious helper actions against the DB
-- (e.g. via DevTools / JS console). The setup wizard (#88) will harden this
-- further by setting app_metadata (service-role only, not user-writable).

-- ── Role helper ──────────────────────────────────────────────────────────────
-- Reads app_role from user_metadata. Defaults to 'helper' (least privilege)
-- so an unauthenticated or uninitialized session never gains couple access.
create or replace function auth.app_role() returns text
  language sql stable
as $$
  select coalesce(
    nullif(auth.jwt() -> 'user_metadata' ->> 'app_role', ''),
    'helper'
  )
$$;

-- ── guests ────────────────────────────────────────────────────────────────────
-- Helpers can SELECT and UPDATE (check-in, angbao) but cannot add or remove guests.
drop policy if exists "helpers_select" on public.guests;
drop policy if exists "helpers_insert" on public.guests;
drop policy if exists "helpers_update" on public.guests;
drop policy if exists "helpers_delete" on public.guests;

create policy "guests_select"
  on public.guests for select
  to authenticated using (true);

create policy "guests_insert"
  on public.guests for insert
  to authenticated
  with check (auth.app_role() = 'couple');

create policy "guests_update"
  on public.guests for update
  to authenticated using (true) with check (true);

create policy "guests_delete"
  on public.guests for delete
  to authenticated
  using (auth.app_role() = 'couple');

-- ── tables (seating) ─────────────────────────────────────────────────────────
-- Seating configuration is couple-managed; helpers only need to read table
-- assignments (for the check-in grid).
drop policy if exists "helpers_select" on public.tables;
drop policy if exists "helpers_insert" on public.tables;
drop policy if exists "helpers_update" on public.tables;
drop policy if exists "helpers_delete" on public.tables;

create policy "tables_select"
  on public.tables for select
  to authenticated using (true);

create policy "tables_insert"
  on public.tables for insert
  to authenticated
  with check (auth.app_role() = 'couple');

create policy "tables_update"
  on public.tables for update
  to authenticated
  using (auth.app_role() = 'couple') with check (auth.app_role() = 'couple');

create policy "tables_delete"
  on public.tables for delete
  to authenticated
  using (auth.app_role() = 'couple');

-- ── submissions ───────────────────────────────────────────────────────────────
-- Helpers can read and update (approve/match) submissions but cannot delete them.
drop policy if exists "helpers_all_submissions" on public.submissions;

create policy "submissions_select"
  on public.submissions for select
  to authenticated using (true);

create policy "submissions_update"
  on public.submissions for update
  to authenticated using (true) with check (true);

create policy "submissions_delete"
  on public.submissions for delete
  to authenticated
  using (auth.app_role() = 'couple');

-- ── weddings (config) ────────────────────────────────────────────────────────
-- The existing "public" policy allowed anon writes — replace with split policies.
drop policy if exists "public" on public.weddings;

-- Anonymous SELECT stays open so WeddingPage.jsx works without auth.
create policy "weddings_select"
  on public.weddings for select
  using (true);

-- All writes require the couple role.
create policy "weddings_write"
  on public.weddings for all
  to authenticated
  using (auth.app_role() = 'couple')
  with check (auth.app_role() = 'couple');

-- ── vendors (financial data) ─────────────────────────────────────────────────
-- Helpers have no access to vendor/budget data — the Budget tab is couple-only.
drop policy if exists "vendors_select" on public.vendors;
drop policy if exists "vendors_insert" on public.vendors;
drop policy if exists "vendors_update" on public.vendors;
drop policy if exists "vendors_delete" on public.vendors;

create policy "vendors_couple_all"
  on public.vendors for all
  to authenticated
  using (auth.app_role() = 'couple')
  with check (auth.app_role() = 'couple');
