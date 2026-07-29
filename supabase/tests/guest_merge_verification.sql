-- Manual verification for guest dedupe + merge (0011_guest_dedupe.sql).
--
-- There is no automated DB test harness in CI (all Vitest tests are pure unit
-- tests), so run this by hand after applying migrations — in the Supabase SQL
-- editor or `psql` against a local `supabase start` stack. Every block runs
-- inside a transaction that is ROLLED BACK, so it mutates nothing permanently.
--
-- Unlike role_rls_verification.sql (whose assertions are eyeballed in the
-- comments), this file uses `assert` so it fails loudly: merge_guests deletes a
-- row and the failure modes it guards against — cascading away a party, a
-- duplicate-key error on shared events, an orphaned ang-bao submission — are all
-- silent if you are only skimming result sets.
--
-- Expected output: every block prints NOTICE lines and no ERROR. Any ERROR that
-- is not the deliberate "expected 42501" notice is a real failure.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Full merge: fields, events, children, submission, draw number
-- ─────────────────────────────────────────────────────────────────────────────
begin;
  update public.app_config set value = 'helper@wedding.local' where key = 'helper_email';
  update public.app_config set value = 'couple@wedding.local' where key = 'couple_email';

do $$
declare
  v_wedding    uuid;
  v_event_both uuid;
  v_event_dup  uuid;
  v_canon      uuid;
  v_dup        uuid;
  v_child      uuid;
  v_submission uuid;
  v_audit      uuid;
  v_row        public.guests%rowtype;
  v_status     text;
  v_count      int;
  v_parent     uuid;
  v_matched    uuid;
begin
  -- ── Fixtures ───────────────────────────────────────────────────────────────
  -- weddings is a singleton by convention; reuse the row if the deployment
  -- already has one rather than creating a second.
  select id into v_wedding from public.weddings limit 1;
  if v_wedding is null then
    insert into public.weddings default values returning id into v_wedding;
  end if;

  insert into public.wedding_events (wedding_id, name, is_active)
    values (v_wedding, 'Shared Event', true) returning id into v_event_both;
  insert into public.wedding_events (wedding_id, name, is_active)
    values (v_wedding, 'Duplicate-only Event', true) returning id into v_event_dup;

  -- Canonical: pre-invited, confirmed, seated, no phone, no draw number.
  insert into public.guests (name, rsvp_status, email, table_number, draw_number)
    values ('Wei Ming Tan', 'confirmed', 'wei@example.com', '5', null)
    returning id into v_canon;

  -- Duplicate: self-registered walk-in with a phone, a meal, a plus-one,
  -- an ang-bao, a draw number, and a MORE RECENT answer on the shared event.
  insert into public.guests (name, self_registered, rsvp_status, phone, meal_choice,
                             angbao_given, angbao_amount, checked_in, draw_number)
    values ('Wei-Ming  TAN', true, 'confirmed', '91230000', 'Vegetarian',
            true, 88, true, 42)
    returning id into v_dup;

  insert into public.guests (name, primary_guest_id)
    values ('Amy Tan', v_dup) returning id into v_child;

  insert into public.guest_event_rsvps (guest_id, event_id, invited, status, responded_at)
    values (v_canon, v_event_both, true, 'confirmed', now() - interval '2 days');
  insert into public.guest_event_rsvps (guest_id, event_id, invited, status, responded_at)
    values (v_dup,   v_event_both, true, 'declined',  now());              -- newer → wins
  insert into public.guest_event_rsvps (guest_id, event_id, invited, status, responded_at)
    values (v_dup,   v_event_dup,  true, 'confirmed', now());              -- canonical absent → moves

  insert into public.submissions (guest_name, receipt_path, matched_guest_id, status)
    values ('Wei-Ming Tan', 'receipts/merge-test.png', v_dup, 'approved')
    returning id into v_submission;

  -- ── Sanity: the pair is actually detected ──────────────────────────────────
  assert public.normalize_guest_name('Wei-Ming  TAN')
       = public.normalize_guest_name('Wei Ming Tan'),
    'normalize_guest_name should collapse punctuation, case and spacing';

  -- ── Merge, as the couple ───────────────────────────────────────────────────
  set local role authenticated;
  set local request.jwt.claims = '{"role":"authenticated","email":"couple@wedding.local"}';

  select count(*) into v_count from public.get_duplicate_candidates()
    where duplicate_id = v_dup and canonical_id = v_canon;
  assert v_count = 1, 'get_duplicate_candidates should offer the seeded pair, got ' || v_count;

  v_audit := public.merge_guests(v_canon, v_dup);
  reset role;

  -- ── Assertions ─────────────────────────────────────────────────────────────
  select * into v_row from public.guests where id = v_canon;

  assert not exists (select 1 from public.guests where id = v_dup),
    'duplicate row should be deleted';

  assert v_row.phone = '91230000',        'blank canonical phone should be filled from the duplicate';
  assert v_row.meal_choice = 'Vegetarian','blank canonical meal_choice should be filled';
  assert v_row.email = 'wei@example.com', 'populated canonical email must win';
  assert v_row.table_number = '5',        'canonical seating must be preserved';

  -- D-Day state must never be cleared by an administrative merge.
  assert v_row.checked_in,                'check-in must carry over';
  assert v_row.angbao_given,              'angbao_given must carry over';
  assert v_row.angbao_amount = 88,        'ang-bao amount should fill a zero canonical';
  assert v_row.draw_number = 42,          'draw number should transfer without a unique violation';

  -- Newest answer wins on the shared event; the duplicate-only event moves over.
  select status into v_status from public.guest_event_rsvps
    where guest_id = v_canon and event_id = v_event_both;
  assert v_status = 'declined',
    'shared event should take the duplicate''s newer answer, got ' || coalesce(v_status, '<none>');

  select count(*) into v_count from public.guest_event_rsvps
    where guest_id = v_canon and event_id = v_event_dup;
  assert v_count = 1, 'duplicate-only event should move to the canonical';

  select count(*) into v_count from public.guest_event_rsvps where guest_id = v_dup;
  assert v_count = 0, 'no event rows should remain on the deleted guest';

  -- primary_guest_id is ON DELETE CASCADE — the child must have been reparented
  -- BEFORE the delete, or it is gone.
  select primary_guest_id into v_parent from public.guests where id = v_child;
  assert found, 'plus-one must survive the merge (ON DELETE CASCADE regression)';
  assert v_parent = v_canon, 'plus-one must be reparented to the canonical';

  -- submissions.matched_guest_id is ON DELETE SET NULL — repointed, not orphaned.
  select matched_guest_id into v_matched from public.submissions where id = v_submission;
  assert v_matched = v_canon, 'approved submission must be repointed, not orphaned';

  -- Audit trail captured the whole row, not a column whitelist.
  assert exists (
    select 1 from public.guest_merges
     where id = v_audit
       and merged_guest_snapshot ->> 'name' = 'Wei-Ming  TAN'
       and (merged_guest_snapshot ->> 'self_registered')::boolean
       and jsonb_array_length(merged_event_rsvps) = 2
       and jsonb_array_length(merged_children) = 1
  ), 'guest_merges must hold the full snapshot of the deleted guest';

  raise notice 'BLOCK 1 PASSED — full merge behaves correctly';
end $$;
rollback;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The helper is refused (security definer bypasses RLS, so the RPC gates)
-- ─────────────────────────────────────────────────────────────────────────────
begin;
  update public.app_config set value = 'helper@wedding.local' where key = 'helper_email';
  update public.app_config set value = 'couple@wedding.local' where key = 'couple_email';

do $$
declare
  v_a uuid;
  v_b uuid;
  v_n int;
begin
  insert into public.guests (name) values ('Merge Gate A') returning id into v_a;
  insert into public.guests (name, self_registered) values ('Merge Gate  A', true) returning id into v_b;

  set local role authenticated;
  set local request.jwt.claims = '{"role":"authenticated","email":"helper@wedding.local"}';

  -- A helper sees no candidates at all (gated in the WHERE clause, like
  -- get_budget_config — returns zero rows rather than raising).
  select count(*) into v_n from public.get_duplicate_candidates();
  assert v_n = 0, 'helper must see no duplicate candidates, got ' || v_n;

  begin
    perform public.merge_guests(v_a, v_b);
    reset role;
    raise exception 'SECURITY REGRESSION: helper was allowed to merge guests';
  exception
    when insufficient_privilege then
      reset role;
      raise notice 'BLOCK 2 PASSED — helper merge refused with 42501 as expected';
  end;

  -- And the guests are untouched.
  assert (select count(*) from public.guests where id in (v_a, v_b)) = 2,
    'a refused merge must not delete anything';
end $$;
rollback;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Guard rails: self-merge, plus-ones, dismissals
-- ─────────────────────────────────────────────────────────────────────────────
begin;
  update public.app_config set value = 'couple@wedding.local' where key = 'couple_email';

do $$
declare
  v_a     uuid;
  v_b     uuid;
  v_child uuid;
  v_n     int;
begin
  insert into public.guests (name) values ('Guard A') returning id into v_a;
  insert into public.guests (name, self_registered) values ('Guard  A', true) returning id into v_b;
  insert into public.guests (name, primary_guest_id) values ('Guard Child', v_a) returning id into v_child;

  set local role authenticated;
  set local request.jwt.claims = '{"role":"authenticated","email":"couple@wedding.local"}';

  begin
    perform public.merge_guests(v_a, v_a);
    -- Wording deliberately avoids the substring matched below, or the handler
    -- would swallow this regression as a pass.
    raise exception 'REGRESSION: a self-merge was allowed';
  exception when others then
    if sqlerrm like '%itself%' then
      raise notice 'self-merge refused as expected';
    else raise; end if;
  end;

  begin
    perform public.merge_guests(v_a, v_child);
    raise exception 'REGRESSION: merging a plus-one was allowed';
  exception when others then
    if sqlerrm like '%primary%' then
      raise notice 'plus-one merge refused as expected';
    else raise; end if;
  end;

  -- Dismissing the pair removes it from the candidate list, in either direction.
  select count(*) into v_n from public.get_duplicate_candidates()
    where duplicate_id = v_b and canonical_id = v_a;
  assert v_n = 1, 'pair should be offered before dismissal, got ' || v_n;

  perform public.dismiss_duplicate_pair(v_b, v_a);   -- deliberately reversed order

  select count(*) into v_n from public.get_duplicate_candidates()
    where duplicate_id = v_b and canonical_id = v_a;
  assert v_n = 0, 'dismissed pair must not be offered again, got ' || v_n;

  reset role;
  raise notice 'BLOCK 3 PASSED — guard rails and dismissals behave correctly';
end $$;
rollback;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Two walk-ins matching each other are offered ONCE, not mirrored
-- ─────────────────────────────────────────────────────────────────────────────
-- Both rows are self-registered, so both land in the candidate query's `dupes`
-- set and the pair would be emitted as A→B and B→A. Only the newer→older
-- direction should survive; the mirror would otherwise linger on screen after
-- one direction was dismissed, since dismissals are stored canonically.
begin;
  update public.app_config set value = 'couple@wedding.local' where key = 'couple_email';

do $$
declare
  v_old uuid;
  v_new uuid;
  v_n   int;
begin
  insert into public.guests (name, self_registered, created_at)
    values ('Walkin Tan', true, now() - interval '1 hour') returning id into v_old;
  insert into public.guests (name, self_registered, created_at)
    values ('Walkin  TAN', true, now()) returning id into v_new;

  set local role authenticated;
  set local request.jwt.claims = '{"role":"authenticated","email":"couple@wedding.local"}';

  select count(*) into v_n from public.get_duplicate_candidates()
    where duplicate_id in (v_old, v_new) and canonical_id in (v_old, v_new);
  assert v_n = 1, 'walk-in pair must be offered exactly once, got ' || v_n;

  select count(*) into v_n from public.get_duplicate_candidates()
    where duplicate_id = v_new and canonical_id = v_old;
  assert v_n = 1, 'the newer walk-in should be the one offered for merging';

  reset role;
  raise notice 'BLOCK 4 PASSED — walk-in pairs are not mirrored';
end $$;
rollback;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RSVP-email suppression is transaction-local
-- ─────────────────────────────────────────────────────────────────────────────
-- merge_guests can move the canonical from 'pending' to 'confirmed', which would
-- otherwise fire notify_rsvp_status_change and email the guest a confirmation
-- they did not just trigger. The suppression flag must not leak past the merge's
-- transaction, or genuine RSVPs afterwards would stop sending mail.
--
-- Note: whether net.http_post is actually skipped can only be observed on a
-- deployment with the vault secrets set (rsvp_email_webhook_url / _secret). On a
-- stock local stack those are absent and the webhook no-ops regardless, so this
-- block verifies the scoping, and the skip itself is verified by reading
-- notify_rsvp_status_change in 0011.
begin;
do $$
begin
  perform set_config('app.suppress_rsvp_email', 'on', true);
  assert current_setting('app.suppress_rsvp_email', true) = 'on',
    'suppression flag should be set inside the transaction';
end $$;
rollback;

do $$
begin
  assert coalesce(current_setting('app.suppress_rsvp_email', true), '') <> 'on',
    'SECURITY REGRESSION: suppression flag leaked past its transaction — '
    'genuine RSVP confirmation emails would stop sending';
  raise notice 'BLOCK 5 PASSED — email suppression is transaction-local';
end $$;
