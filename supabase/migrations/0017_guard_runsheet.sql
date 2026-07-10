-- 0017 — Guard the runsheet write RPC against anon and the helper role.
--
-- upsert_runsheet (0013) is `security definer`, so it runs as the owner and
-- BYPASSES the row-level policies on public.weddings (`weddings_write ...
-- not is_helper()`, 0011 §8). It was created with
-- `grant execute ... to anon, authenticated` and no internal role check —
-- meaning the PUBLIC anon key alone (shipped in the browser bundle) could
-- overwrite the couple's wedding-day runsheet, and so could a signed-in
-- helper. This is the same hole class 0015 (#101) closed for
-- upsert_wedding_config / upsert_wedding_page.
--
-- Fix: re-create the function with the same internal gate used by
-- upsert_budget_config (0011) and the 0015 guards — raise `42501
-- insufficient_privilege` when the caller is the helper — and close the
-- grant layer to `authenticated` only. Body is otherwise identical to 0013,
-- so `create or replace` suffices.
--
-- Lockout safety: public.is_helper() (0010) FAILS OPEN — it returns false on
-- any internal error — so this guard can never block the couple.

-- ── 1. upsert_runsheet — body from 0013, plus the helper gate ─────────────────
create or replace function public.upsert_runsheet(
  p_runsheet              jsonb,
  p_is_runsheet_published boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Couple-only: security definer bypasses the weddings_write RLS policy, so
  -- the role gate must live inside the function (same pattern as 0015).
  if (select public.is_helper()) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  insert into public.weddings (bride_name, groom_name, runsheet, is_runsheet_published, updated_at)
  values ('', '', coalesce(p_runsheet, '[]'::jsonb), coalesce(p_is_runsheet_published, false), now())
  on conflict ((true)) do update set
    runsheet              = coalesce(excluded.runsheet, '[]'::jsonb),
    is_runsheet_published = coalesce(excluded.is_runsheet_published, false),
    updated_at            = now();
end;
$$;

revoke all on function public.upsert_runsheet(jsonb, boolean) from public, anon;
grant execute on function public.upsert_runsheet(jsonb, boolean) to authenticated;

-- ── 2. Audit trail: the runsheet READ surface stays open by design ────────────
-- get_public_runsheet (0013) is anon-callable on purpose: it returns only
-- published runsheets (`is_runsheet_published = true`) for the public
-- /runsheet/:slug page and exposes no couple-only data. get_wedding_config's
-- anon grant (re-asserted by 0013) likewise predates this migration and backs
-- the public wedding page. Neither needs a gate.
comment on function public.get_public_runsheet(text) is
  'Intentionally anon-callable: read-only, published-runsheets-only surface for the public /runsheet/:slug page (0013). Do not add an is_helper() gate.';
