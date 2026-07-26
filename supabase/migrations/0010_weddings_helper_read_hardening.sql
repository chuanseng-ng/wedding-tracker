-- ─────────────────────────────────────────────────────────────────────────────
-- 0010_weddings_helper_read_hardening.sql — close the helper read gap on the
-- singleton weddings row (security advisory: weddings_select leaked couple-only
-- columns to the helper account)
--
-- Problem: the weddings_select RLS policy (0003_weddings_page.sql) was
--   `for select to authenticated using (true)`.
-- RLS filters rows, not columns, so any signed-in account — INCLUDING the shared
-- helper — could `select *` on the one weddings row and read fields the app
-- treats as couple-only: overall_budget_cap, budget_categories, checklist,
-- rsvp_pin, photowall_pin. The couple-only reader RPCs (get_budget_config,
-- get_checklist_config, get_open_rsvp_admin_config, get_photowall_admin_config,
-- each gated `where not public.is_helper()`) exist precisely to hide those, but a
-- direct PostgREST select bypassed them entirely. A helper who read rsvp_pin /
-- photowall_pin could then drive the anon open-RSVP / photowall flows.
--
-- Fix: restrict weddings_select to the couple (not is_helper()), matching the
-- existing weddings_write policy. The one thing the helper legitimately reads off
-- the row — the floorplan snapshots (#162) for the D-Day seating view — now comes
-- through a security-definer projection (get_wedding_floorplans) that exposes ONLY
-- the floorplans column, mirroring the get_checkin_guests pattern (0005). Every
-- other wedding field the helper sees already flows through the RLS-bypassing
-- get_wedding_config RPC and is unaffected.
--
-- Idempotent: drop-if-exists policy + create; drop-if-exists function + create.
-- (Folds into 0003_weddings_page.sql / 0005_roles_security.sql at the next
-- migration-consolidation round.)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Tighten the SELECT policy to couple-only ───────────────────────────────
-- Helpers no longer read the weddings row directly at all (was `using (true)`).
drop policy if exists "weddings_select" on public.weddings;
create policy "weddings_select" on public.weddings
  for select to authenticated using (not (select public.is_helper()));

-- ── 2. Helper-safe floorplans projection ──────────────────────────────────────
-- Restricting weddings_select hid the whole row from the helper, but the D-Day
-- floorplan/seating view still needs the floorplan snapshots. Expose ONLY that
-- column through a security-definer projection (RLS cannot hide columns, so the
-- helper's read routes through this instead of a direct select — same rationale
-- as get_checkin_guests). Not granted to anon: floorplans are deliberately kept
-- out of the anon-granted get_wedding_config so they never ship to the public
-- page.
drop function if exists public.get_wedding_floorplans();
create function public.get_wedding_floorplans()
returns table (
  floorplans jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  -- Column is alias-qualified so it can never collide with the `returns table`
  -- output name. weddings is a singleton (one row), so limit 1 is exact.
  select w.floorplans
  from public.weddings w
  limit 1;
$$;

revoke all on function public.get_wedding_floorplans() from public, anon;
grant execute on function public.get_wedding_floorplans() to authenticated;

comment on function public.get_wedding_floorplans() is
  'Helper-safe projection of the singleton weddings row exposing ONLY floorplans (#162), so the D-Day helper seating/floorplan view keeps working after weddings_select was restricted to the couple. RLS cannot hide columns, so the helper reads floorplans through this instead of a direct select. Keep couple-only columns (overall_budget_cap, budget_categories, checklist, rsvp_pin, photowall_pin) OUT — and do NOT grant to anon (get_wedding_config stays floorplan-free).';
