-- Manual verification for the RSVP deadline lock (#179,
-- 0011_rsvp_deadline_lock.sql): the two weddings columns, public.is_rsvp_locked()
-- and its timezone handling, the guard on all three anon-facing RSVP write RPCs
-- (submit_rsvp, submit_rsvp_events, register_open_rsvp), the upsert_wedding_page
-- round-trip incl. unknown-zone clamping, and get_wedding_config's three new
-- APPENDED columns (clients read that row positionally).
--
-- Run by hand after applying migrations, in the Supabase SQL editor or `psql`
-- against a local `supabase start` stack (same convention as
-- role_rls_verification.sql — there is no automated DB harness in CI). The whole
-- script runs in one rolled-back transaction and asserts loudly: if it completes
-- with no error, every check passed.

begin;

-- ── 0. Fixtures ───────────────────────────────────────────────────────────────
-- A singleton wedding row plus one guest whose token drives the submit RPCs.
insert into public.weddings (bride_name, groom_name, wedding_date, slug)
values ('Lock Bride', 'Lock Groom', current_date + 200, 'lock-test')
on conflict ((true)) do update set bride_name = excluded.bride_name;

insert into public.guests (name, email)
values ('Deadline Tester', 'deadline.tester@example.com')
on conflict do nothing;

-- ── 1. Columns exist with the documented defaults ─────────────────────────────
do $$
declare
  v_lock_default text;
  v_tz_default   text;
  v_lock_notnull boolean;
  v_tz_notnull   boolean;
begin
  select column_default, (is_nullable = 'NO') into v_lock_default, v_lock_notnull
  from information_schema.columns
  where table_schema = 'public' and table_name = 'weddings'
    and column_name = 'lock_rsvp_after_deadline';

  select column_default, (is_nullable = 'NO') into v_tz_default, v_tz_notnull
  from information_schema.columns
  where table_schema = 'public' and table_name = 'weddings'
    and column_name = 'wedding_timezone';

  assert v_lock_default is not null, 'weddings.lock_rsvp_after_deadline is missing';
  assert v_tz_default   is not null, 'weddings.wedding_timezone is missing';
  assert v_lock_notnull, 'lock_rsvp_after_deadline should be NOT NULL';
  assert v_tz_notnull,   'wedding_timezone should be NOT NULL';

  -- The defaults are load-bearing: every pre-#179 deployment must upgrade to
  -- "feature off", i.e. behave exactly as it did before.
  assert v_lock_default like '%false%',
    format('lock_rsvp_after_deadline should default to false, got %s', v_lock_default);
  assert v_tz_default like '%Asia/Singapore%',
    format('wedding_timezone should default to Asia/Singapore, got %s', v_tz_default);
end $$;

-- ── 2. is_rsvp_locked — fails open, and the deadline day is inclusive ─────────
do $$
begin
  -- Flag off → never locked, however long ago the deadline was.
  update public.weddings set
    lock_rsvp_after_deadline = false,
    rsvp_deadline            = current_date - 30,
    wedding_timezone         = 'Asia/Singapore';
  assert not public.is_rsvp_locked(), 'locked while the feature is switched off';

  -- Flag on but no deadline set → nothing to lock against.
  update public.weddings set lock_rsvp_after_deadline = true, rsvp_deadline = null;
  assert not public.is_rsvp_locked(), 'locked with no rsvp_deadline set';

  -- Deadline in the future → open.
  update public.weddings set rsvp_deadline = current_date + 30;
  assert not public.is_rsvp_locked(), 'locked before the deadline';

  -- The deadline day ITSELF is inclusive — guests get the whole day.
  update public.weddings set
    rsvp_deadline = (now() at time zone 'Asia/Singapore')::date;
  assert not public.is_rsvp_locked(), 'locked ON the deadline day (must be inclusive)';

  -- Yesterday (in the wedding's zone) → locked.
  update public.weddings set
    rsvp_deadline = (now() at time zone 'Asia/Singapore')::date - 1;
  assert public.is_rsvp_locked(), 'not locked the day after the deadline';
end $$;

-- The cutoff must follow wedding_timezone, not the server clock. Pick the
-- deadline so that "today" differs between two zones ~13h apart, then assert the
-- verdict flips with the setting. Skipped near the couple of hours where both
-- zones agree on the date, since then there is nothing to distinguish.
do $$
declare
  v_sg date := (now() at time zone 'Pacific/Kiritimati')::date;  -- UTC+14
  v_mw date := (now() at time zone 'Pacific/Midway')::date;      -- UTC-11
begin
  if v_sg = v_mw then
    raise notice 'timezone check skipped: both zones are on % right now', v_sg;
  else
    -- Deadline = the EARLIER zone's date. It is already past in UTC+14
    -- (which has rolled over) but is still today in UTC-11.
    update public.weddings set rsvp_deadline = v_mw, wedding_timezone = 'Pacific/Kiritimati';
    assert public.is_rsvp_locked(),
      'should be locked in the zone that already rolled past the deadline';

    update public.weddings set wedding_timezone = 'Pacific/Midway';
    assert not public.is_rsvp_locked(),
      'should still be open in the zone that has not reached midnight yet';
  end if;
end $$;

-- An unrecognised zone must fall back, not raise — a hand-edited row cannot be
-- allowed to take down the anon-facing get_wedding_config / submit path.
do $$
declare
  v_locked boolean;
begin
  update public.weddings set
    wedding_timezone         = 'Not/AZone',
    lock_rsvp_after_deadline = true,
    rsvp_deadline            = current_date - 5;
  v_locked := public.is_rsvp_locked();   -- must not raise
  assert v_locked, 'unknown timezone should fall back to Asia/Singapore, not unlock';
end $$;

-- ── 3. The three anon-facing write RPCs refuse while locked ──────────────────
do $$
declare
  v_token uuid;
begin
  select rsvp_token into v_token from public.guests where name = 'Deadline Tester';

  update public.weddings set
    lock_rsvp_after_deadline = true,
    wedding_timezone         = 'Asia/Singapore',
    rsvp_deadline            = (now() at time zone 'Asia/Singapore')::date - 1,
    enable_smart_rsvp        = true,
    enable_open_rsvp         = true,
    rsvp_pin                 = '1234';

  begin
    perform public.submit_rsvp(v_token, 'confirmed');
    raise exception 'submit_rsvp accepted a write after the deadline';
  exception when others then
    assert sqlerrm like '%rsvp closed%',
      format('submit_rsvp raised the wrong error: %s', sqlerrm);
  end;

  begin
    perform public.submit_rsvp_events(v_token, 'a@example.com');
    raise exception 'submit_rsvp_events accepted a write after the deadline';
  exception when others then
    assert sqlerrm like '%rsvp closed%',
      format('submit_rsvp_events raised the wrong error: %s', sqlerrm);
  end;

  -- Open mode is a submit path too: an unguarded register would create a guest
  -- row for someone the form is about to refuse.
  begin
    perform public.register_open_rsvp('Walk In Guest', '1234');
    raise exception 'register_open_rsvp accepted a registration after the deadline';
  exception when others then
    assert sqlerrm like '%rsvp closed%',
      format('register_open_rsvp raised the wrong error: %s', sqlerrm);
  end;

  assert not exists (select 1 from public.guests where name = 'Walk In Guest'),
    'register_open_rsvp created a guest row despite the lock';
end $$;

-- ── 4. …and accept again the moment the couple switches the lock off ─────────
do $$
declare
  v_token uuid;
  v_status text;
begin
  select rsvp_token into v_token from public.guests where name = 'Deadline Tester';

  update public.weddings set lock_rsvp_after_deadline = false, enable_smart_rsvp = false;

  perform public.submit_rsvp(v_token, 'confirmed');
  select rsvp_status into v_status from public.guests where rsvp_token = v_token;
  assert v_status = 'confirmed',
    format('submit_rsvp should work with the lock off, status is %s', v_status);

  perform public.register_open_rsvp('Walk In Guest', '1234');
  assert exists (select 1 from public.guests where name = 'Walk In Guest'),
    'register_open_rsvp should work with the lock off';
end $$;

-- ── 5. get_wedding_config exposes the three new columns, APPENDED ────────────
-- Column order is load-bearing: RsvpPage / AdminApp read this row positionally.
do $$
declare
  v_cols text[];
  v_n    int;
begin
  select array_agg(p.proargnames[i] order by i)
    into v_cols
  from pg_proc p,
       lateral generate_subscripts(p.proargnames, 1) i
  where p.oid = 'public.get_wedding_config()'::regprocedure;

  v_n := array_length(v_cols, 1);
  assert v_cols[v_n - 2] = 'lock_rsvp_after_deadline',
    format('expected lock_rsvp_after_deadline 3rd from last, got %s', v_cols[v_n - 2]);
  assert v_cols[v_n - 1] = 'wedding_timezone',
    format('expected wedding_timezone 2nd from last, got %s', v_cols[v_n - 1]);
  assert v_cols[v_n] = 'rsvp_locked',
    format('expected rsvp_locked last, got %s', v_cols[v_n]);
end $$;

-- The served rsvp_locked must agree with is_rsvp_locked() — the whole point of
-- computing it server-side is that the form and the RPC cannot disagree.
do $$
declare
  v_row record;
begin
  update public.weddings set
    lock_rsvp_after_deadline = true,
    wedding_timezone         = 'Asia/Singapore',
    rsvp_deadline            = (now() at time zone 'Asia/Singapore')::date - 1;

  select * into v_row from public.get_wedding_config();
  assert v_row.rsvp_locked, 'get_wedding_config().rsvp_locked disagrees with is_rsvp_locked()';
  assert v_row.lock_rsvp_after_deadline, 'lock_rsvp_after_deadline not surfaced';
  assert v_row.wedding_timezone = 'Asia/Singapore', 'wedding_timezone not surfaced';

  update public.weddings set lock_rsvp_after_deadline = false;
  select * into v_row from public.get_wedding_config();
  assert not v_row.rsvp_locked, 'rsvp_locked stayed true after the switch was turned off';
end $$;

-- ── 6. upsert_wedding_page round-trips both settings and clamps a bad zone ───
do $$
declare
  v_lock boolean;
  v_tz   text;
begin
  perform public.upsert_wedding_page(
    'lock-test', '', '', '', '[]'::jsonb, current_date + 10, true, '',
    '', 'minimal', false, '', '', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'center', '',
    true, 'Europe/London'
  );
  select lock_rsvp_after_deadline, wedding_timezone into v_lock, v_tz from public.weddings;
  assert v_lock, 'upsert_wedding_page did not persist lock_rsvp_after_deadline';
  assert v_tz = 'Europe/London',
    format('upsert_wedding_page did not persist wedding_timezone, got %s', v_tz);

  -- A stale or malicious client must not be able to fail the couple's whole save.
  perform public.upsert_wedding_page(
    'lock-test', '', '', '', '[]'::jsonb, current_date + 10, true, '',
    '', 'minimal', false, '', '', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'center', '',
    true, 'Middle/Earth'
  );
  select wedding_timezone into v_tz from public.weddings;
  assert v_tz = 'Asia/Singapore',
    format('unknown timezone should clamp to Asia/Singapore, got %s', v_tz);
end $$;

-- ── 7. Grants: is_rsvp_locked stays off the anon surface ─────────────────────
-- Clients read the computed rsvp_locked out of get_wedding_config instead.
do $$
begin
  assert not has_function_privilege('anon', 'public.is_rsvp_locked()', 'execute'),
    'is_rsvp_locked should NOT be executable by anon';
  assert has_function_privilege('anon', 'public.get_wedding_config()', 'execute'),
    'get_wedding_config must stay anon-callable — the public RSVP form reads it';
  assert not has_function_privilege('anon',
    'public.upsert_wedding_page(text, text, text, text, jsonb, date, boolean, text, text, text, boolean, text, text, jsonb, jsonb, jsonb, text, text, boolean, text)',
    'execute'),
    'upsert_wedding_page must not be anon-callable';
end $$;

rollback;
