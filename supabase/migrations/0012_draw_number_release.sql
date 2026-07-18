-- ── 0012: reusable lucky-draw numbers (#150) ──────────────────────────────────
-- Before this migration, draw numbers were assign-once off a sequence: unmarking
-- an angbao kept the number forever, so an accidental "Received" permanently
-- consumed a raffle ticket. Now the numbers are a reusable pool:
--   * assign_draw_number hands out the LOWEST free positive integer (numbers
--     stay dense 1..N, matching physical ticket stubs) — still only while the
--     guest's draw_number is null;
--   * release_draw_number returns a guest's number to the pool (called when the
--     angbao is unmarked); a re-mark simply mints again and may legitimately
--     receive the same number back.

-- ── 1. Lowest-free allocation ─────────────────────────────────────────────────
-- The advisory lock serialises concurrent mints so two helpers confirming at the
-- same instant can't compute the same "lowest free" value; the unique constraint
-- on guests.draw_number (0001_core.sql) remains as a backstop. SECURITY DEFINER
-- so the update works regardless of the caller's grants (helpers have no direct
-- UPDATE on guests since #92).
drop function if exists public.assign_draw_number(uuid);
create function public.assign_draw_number(p_guest_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('assign_draw_number'));
  update public.guests
    set draw_number = (
      select min(s.n)
      from generate_series(
        1,
        (select count(*) from public.guests where draw_number is not null) + 1
      ) as s(n)
      where not exists (
        select 1 from public.guests g where g.draw_number = s.n
      )
    )
    where id = p_guest_id and draw_number is null;
  select draw_number into n from public.guests where id = p_guest_id;
  return n;
end;
$$;

revoke all on function public.assign_draw_number(uuid) from public;
grant execute on function public.assign_draw_number(uuid) to authenticated;

-- Re-apply the intent marker from 0005 (dropped with the old function above).
comment on function public.assign_draw_number(uuid) is
  'Intentionally helper-callable: mints the lowest free lucky-draw number during D-Day check-in (0012). Writes no financial data. Do not add an is_helper() gate.';

-- ── 2. Release back to the pool ───────────────────────────────────────────────
-- Narrow security-definer write in the set_guest_checkin mould (0005): touches
-- only draw_number, parameterised id, granted to both signed-in roles (the
-- couple unmarks today; #151 will let helpers do the same).
drop function if exists public.release_draw_number(uuid);
create function public.release_draw_number(p_guest_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.guests set draw_number = null where id = p_guest_id;
$$;

revoke all on function public.release_draw_number(uuid) from public;
grant execute on function public.release_draw_number(uuid) to authenticated;

comment on function public.release_draw_number(uuid) is
  'Returns a guest''s lucky-draw number to the reusable pool when their angbao is unmarked (#150). Writes no financial data.';

-- ── 3. One-time backfill ──────────────────────────────────────────────────────
-- Clear the stale numbers this bug left behind (guests unmarked while keeping
-- their number). Idempotent: re-running matches nothing new.
update public.guests
  set draw_number = null
  where angbao_given = false and draw_number is not null;

-- ── 4. Retire the sequence ────────────────────────────────────────────────────
-- Allocation no longer uses draw_number_seq (0001_core.sql still creates it on a
-- fresh reset; harmless, and dropped again here).
drop sequence if exists public.draw_number_seq;
