-- Manual verification for reusable lucky-draw numbers (#150; migration 0012).
--
-- Run by hand after applying migrations, in the Supabase SQL editor or `psql`
-- against a local `supabase start` stack (same convention as
-- role_rls_verification.sql — there is no automated DB harness in CI). The
-- whole script runs in one rolled-back transaction and asserts loudly: if it
-- completes with no error, every check passed.

begin;

do $$
declare
  a uuid; b uuid; c uuid;
  n int;
begin
  -- Three scratch guests (rolled back at the end).
  insert into public.guests (name) values ('Draw Test A') returning id into a;
  insert into public.guests (name) values ('Draw Test B') returning id into b;
  insert into public.guests (name) values ('Draw Test C') returning id into c;

  -- Work on a clean pool so lowest-free is deterministic within this txn.
  update public.guests set draw_number = null where draw_number is not null;

  -- Dense allocation: 1, 2, 3.
  n := public.assign_draw_number(a);
  assert n = 1, format('first mint: expected 1, got %s', n);
  n := public.assign_draw_number(b);
  assert n = 2, format('second mint: expected 2, got %s', n);
  n := public.assign_draw_number(c);
  assert n = 3, format('third mint: expected 3, got %s', n);

  -- Assign-once while held: re-minting B returns its existing number.
  n := public.assign_draw_number(b);
  assert n = 2, format('re-mint while held: expected 2, got %s', n);

  -- Release B: number cleared...
  perform public.release_draw_number(b);
  select draw_number into n from public.guests where id = b;
  assert n is null, format('release: expected null, got %s', n);

  -- ...and 2 is the lowest free number, so the next mint reuses it.
  n := public.assign_draw_number(b);
  assert n = 2, format('reuse after release: expected 2, got %s', n);

  -- Backfill semantics (0012 §3): an unmarked guest with a stale number is
  -- cleared, a marked guest keeps theirs.
  update public.guests set angbao_given = false where id = b;   -- stale: has #2, not given
  update public.guests set angbao_given = true  where id = c;   -- legit: has #3, given
  update public.guests
    set draw_number = null
    where angbao_given = false and draw_number is not null;
  select draw_number into n from public.guests where id = b;
  assert n is null, 'backfill: stale number should be cleared';
  select draw_number into n from public.guests where id = c;
  assert n = 3, 'backfill: held number of a given angbao must survive';

  raise notice 'draw_number_verification: all assertions passed';
end;
$$;

rollback;  -- scratch guests and every number change above are undone
