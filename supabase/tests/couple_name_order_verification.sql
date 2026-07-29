-- Manual verification for the couple name-order setting (0012_couple_name_order.sql):
-- the weddings.name_order column, its CHECK, the three readers that must expose
-- it as their LAST column (the clients read those rows positionally), and the
-- upsert_wedding_config round-trip + grants.
--
-- Run by hand after applying migrations, in the Supabase SQL editor or `psql`
-- against a local `supabase start` stack (same convention as
-- role_rls_verification.sql — there is no automated DB harness in CI). The whole
-- script runs in one rolled-back transaction and asserts loudly: if it completes
-- with no error, every check passed.

begin;

-- ── 1. Column: exists, defaults to bride_first, rejects anything else ─────────
do $$
declare
  v_default text;
  v_notnull boolean;
begin
  select column_default, (is_nullable = 'NO')
    into v_default, v_notnull
  from information_schema.columns
  where table_schema = 'public' and table_name = 'weddings' and column_name = 'name_order';

  assert v_default is not null, 'weddings.name_order is missing';
  assert v_default like '%bride_first%',
    format('name_order default should be bride_first, got %s', v_default);
  assert v_notnull, 'name_order should be NOT NULL';

  -- Pre-0012 rows must keep rendering bride-first, so the default is load-bearing.
  insert into public.weddings (bride_name, groom_name)
  values ('Default Bride', 'Default Groom')
  on conflict ((true)) do update set bride_name = excluded.bride_name;

  assert (select name_order from public.weddings limit 1) in ('bride_first', 'groom_first'),
    'existing row has an out-of-domain name_order';
end $$;

-- The CHECK must reject an unknown order.
do $$
begin
  update public.weddings set name_order = 'tallest_first';
  raise exception 'weddings_name_order_check did not reject an unknown value';
exception
  when check_violation then null;  -- expected
end $$;

-- ── 2. Readers expose name_order as their LAST column ─────────────────────────
-- Column order is load-bearing: WeddingPage / RsvpPage / RunsheetPage read these
-- rows positionally, so new fields are append-only.
do $$
declare
  r record;
begin
  for r in
    select unnest(array[
      'public.get_wedding_config()',
      'public.get_public_wedding(text)',
      'public.get_public_runsheet(text)'
    ]) as sig
  loop
    assert to_regprocedure(r.sig) is not null, format('%s is missing', r.sig);
    assert trim(pg_get_function_result(to_regprocedure(r.sig))) like '%name_order text)',
      format('%s must return name_order as its LAST column; got: %s',
             r.sig, pg_get_function_result(to_regprocedure(r.sig)));
  end loop;
end $$;

-- ── 3. upsert_wedding_config: new signature only, round-trips + clamps ────────
do $$
begin
  -- The superseded 14-arg overload must be gone, or PostgREST RPC resolution
  -- becomes ambiguous.
  assert to_regprocedure(
    'public.upsert_wedding_config(text, text, date, text, text, text, text, text,'
    || ' boolean, uuid, boolean, text, boolean, text)'
  ) is null, 'the old 14-arg upsert_wedding_config overload still exists';

  assert to_regprocedure(
    'public.upsert_wedding_config(text, text, date, text, text, text, text, text,'
    || ' boolean, uuid, boolean, text, boolean, text, text)'
  ) is not null, 'the 15-arg upsert_wedding_config (p_name_order) is missing';
end $$;

do $$
declare
  v_order text;
begin
  perform public.upsert_wedding_config(
    'Siew Yong', 'Wei Ming', null, 'Venue', null, null, null, null,
    false, null, false, '', false, '', 'groom_first'
  );
  select name_order into v_order from public.weddings limit 1;
  assert v_order = 'groom_first', format('expected groom_first, got %s', v_order);

  -- ...and the reader hands the same value to the client.
  select name_order into v_order from public.get_wedding_config();
  assert v_order = 'groom_first', format('get_wedding_config returned %s', v_order);

  -- An unknown value is clamped in the function, never reaching the CHECK.
  perform public.upsert_wedding_config(
    'Siew Yong', 'Wei Ming', null, 'Venue', null, null, null, null,
    false, null, false, '', false, '', 'tallest_first'
  );
  select name_order into v_order from public.weddings limit 1;
  assert v_order = 'bride_first', format('unknown order should clamp to bride_first, got %s', v_order);

  -- Omitting the argument entirely (older clients) also lands on bride_first.
  perform public.upsert_wedding_config(
    'Siew Yong', 'Wei Ming', null, 'Venue', null, null, null
  );
  select name_order into v_order from public.weddings limit 1;
  assert v_order = 'bride_first', format('default arg should be bride_first, got %s', v_order);
end $$;

-- ── 4. Grants unchanged by the recreate ──────────────────────────────────────
do $$
begin
  -- Readers stay anon-callable (the public page / RSVP form need them).
  assert has_function_privilege('anon', 'public.get_wedding_config()', 'execute'),
    'anon lost execute on get_wedding_config';
  assert has_function_privilege('anon', 'public.get_public_wedding(text)', 'execute'),
    'anon lost execute on get_public_wedding';
  assert has_function_privilege('anon', 'public.get_public_runsheet(text)', 'execute'),
    'anon lost execute on get_public_runsheet';

  -- The write stays couple-only: authenticated yes, anon never.
  assert has_function_privilege('authenticated',
    'public.upsert_wedding_config(text, text, date, text, text, text, text, text,'
    || ' boolean, uuid, boolean, text, boolean, text, text)', 'execute'),
    'authenticated cannot execute the new upsert_wedding_config';
  assert not has_function_privilege('anon',
    'public.upsert_wedding_config(text, text, date, text, text, text, text, text,'
    || ' boolean, uuid, boolean, text, boolean, text, text)', 'execute'),
    'anon must NOT be able to execute upsert_wedding_config';
end $$;

rollback;
