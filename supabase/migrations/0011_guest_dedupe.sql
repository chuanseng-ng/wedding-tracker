-- ─────────────────────────────────────────────────────────────────────────────
-- 0011_guest_dedupe.sql — near-duplicate guest detection + couple-only merge
--
-- Open RSVP (0008) matches a typed name against the guest list by EXACT
-- case-insensitive equality only, so "Wei-Ming Tan" typed by someone already
-- invited as "Wei Ming Tan" becomes a second guest row. 0008 deferred the
-- cleanup to the couple (guests.self_registered) but shipped no tooling for it.
-- This migration adds the tooling:
--
--   * normalize_guest_name()   — the shared matching rule (also used by 0012)
--   * guest_merges             — audit trail; a merge deletes a row, so the
--                                whole row is snapshotted first
--   * duplicate_dismissals     — "not a duplicate", so a pair stays dismissed
--   * get_duplicate_candidates — couple-only scan, self-registered vs everyone
--   * merge_guests             — couple-only, atomic
--
-- merge_guests is the first guest WRITE in the app to go through a
-- security-definer RPC (every other couple guest write goes direct to the table
-- under RLS). It has to be: the merge touches guests, guest_event_rsvps and
-- submissions together and must be all-or-nothing, and the client `sb` wrapper
-- has no transaction helper.
--
-- Idempotent: guarded creates, functions dropped and recreated, policies
-- dropped before create (matching 0005).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. normalize_guest_name — the shared matching rule ────────────────────────
-- Lowercase, collapse every run of non-alphanumerics to one space, trim. So
-- "Wei-Ming  TAN", "wei ming tan" and "Tan, Wei Ming" all reduce to comparable
-- forms. IMMUTABLE so it can back an index.
--
-- [[:alnum:]] is Unicode-aware in a UTF-8 database, so CJK names survive. A
-- naive [^a-z0-9] would erase them entirely — do not "simplify" this.
-- Mirrored in JS by normalizeGuestName() in src/lib/guestDedupe.js.
create or replace function public.normalize_guest_name(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(lower(coalesce(p_name, '')), '[^[:alnum:]]+', ' ', 'g'));
$$;

comment on function public.normalize_guest_name(text) is
  'Shared guest-name matching rule (case/punctuation/spacing insensitive). IMMUTABLE so guests_name_norm_idx can use it. Mirrored by normalizeGuestName() in src/lib/guestDedupe.js — keep both in sync.';

revoke all on function public.normalize_guest_name(text) from public;
grant execute on function public.normalize_guest_name(text) to anon, authenticated;

-- Until now there was NO trigram index on guests.name — the similarity() call in
-- submit_rsvp_by_name (0002) has always been a sequential scan.
--
-- Deliberately NOT adding a functional index on normalize_guest_name(name): an
-- index expression pins the function definition, which would make the shared
-- matching rule painful to revise. The guest list is single-tenant and capped
-- (1000 self-registered rows, 0008), so the candidate scans below are a
-- sequential pass over a few hundred rows.
create index if not exists guests_name_trgm_idx
  on public.guests using gin (name gin_trgm_ops);

-- ── 2. guest_merges — audit trail ─────────────────────────────────────────────
-- A merge DELETES the duplicate row, and the app's existing delete/undo path
-- (AdminApp.undoDelete) only restores a 10-column whitelist — it would silently
-- lose self_registered, email, rsvp_status, rsvp_message. So the merge snapshots
-- the entire row plus its event answers and plus-ones as jsonb, making a wrong
-- merge recoverable by hand.
--
-- canonical_guest_id deliberately has NO foreign key: the audit must survive the
-- canonical being deleted later.
create table if not exists public.guest_merges (
  id                    uuid primary key default gen_random_uuid(),
  canonical_guest_id    uuid,
  canonical_name        text        not null default '',
  merged_guest_snapshot jsonb       not null,
  merged_event_rsvps    jsonb       not null default '[]'::jsonb,
  merged_children       jsonb       not null default '[]'::jsonb,
  dropped_children      jsonb       not null default '[]'::jsonb,
  merged_by             text        not null default '',
  created_at            timestamptz not null default now()
);

create index if not exists guest_merges_created_at_idx
  on public.guest_merges (created_at desc);

alter table public.guest_merges enable row level security;

-- Couple-only SELECT. No insert/update/delete policy for ANY role: only
-- merge_guests (security definer, runs as owner) writes here, so the audit
-- trail cannot be edited or erased from the client.
drop policy if exists "couple_select_guest_merges" on public.guest_merges;
create policy "couple_select_guest_merges" on public.guest_merges
  for select to authenticated using (not (select public.is_helper()));

-- ── 3. duplicate_dismissals — "not a duplicate" ───────────────────────────────
-- Pair ids are stored canonically (least, greatest) and enforced by the check
-- below, so a pair can never be recorded twice under swapped ids.
create table if not exists public.duplicate_dismissals (
  guest_a_id uuid        not null references public.guests(id) on delete cascade,
  guest_b_id uuid        not null references public.guests(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (guest_a_id, guest_b_id),
  constraint duplicate_dismissals_ordered check (guest_a_id < guest_b_id)
);

alter table public.duplicate_dismissals enable row level security;

drop policy if exists "couple_all_duplicate_dismissals" on public.duplicate_dismissals;
create policy "couple_all_duplicate_dismissals" on public.duplicate_dismissals
  for all to authenticated
  using (not (select public.is_helper()))
  with check (not (select public.is_helper()));

-- ── 4. get_duplicate_candidates — couple-only scan ────────────────────────────
-- Scope: each self-registered PRIMARY guest, compared against every other
-- primary. That targets the actual failure mode (an open-RSVP walk-in
-- duplicating someone already invited, or another walk-in) without flooding the
-- couple with false positives from their own curated list.
--
-- A pair matches when the normalized names are equal, or trigram similarity is
-- at least 0.55. 0.55 is deliberately stricter than the 0.4 used by the legacy
-- submit_rsvp_by_name — mirrored by DEDUPE_THRESHOLD in src/lib/guestDedupe.js.
--
-- Ranking prefers a pre-invited canonical (self_registered = false) over another
-- walk-in, then higher similarity: merging INTO the couple's own row is almost
-- always what they want.
drop function if exists public.get_duplicate_candidates();

create function public.get_duplicate_candidates()
returns table (
  duplicate_id         uuid,
  duplicate_name       text,
  duplicate_created_at timestamptz,
  canonical_id         uuid,
  canonical_name       text,
  similarity           real,
  match_kind           text
)
language sql
stable
security definer
set search_path = public
as $$
  with dupes as (
    select g.id, g.name, g.created_at
      from public.guests g
     where g.self_registered
       and g.primary_guest_id is null
       and not (select public.is_helper())
  ),
  pairs as (
    select d.id                                                as duplicate_id,
           d.name                                              as duplicate_name,
           d.created_at                                        as duplicate_created_at,
           c.id                                                as canonical_id,
           c.name                                              as canonical_name,
           similarity(public.normalize_guest_name(d.name),
                      public.normalize_guest_name(c.name))     as similarity,
           case
             when public.normalize_guest_name(d.name)
                = public.normalize_guest_name(c.name) then 'normalized'
             else 'fuzzy'
           end                                                 as match_kind,
           c.self_registered                                   as canonical_self_registered
      from dupes d
      join public.guests c
        on c.id <> d.id
       and c.primary_guest_id is null
     where public.normalize_guest_name(d.name) <> ''
       and public.normalize_guest_name(c.name) <> ''
       and (
             public.normalize_guest_name(d.name) = public.normalize_guest_name(c.name)
          or similarity(public.normalize_guest_name(d.name),
                        public.normalize_guest_name(c.name)) >= 0.55
           )
       -- Two self-registered walk-ins matching each other are BOTH in `dupes`,
       -- so the pair would be emitted twice (A→B and B→A). Keep one direction:
       -- the newer row merges into the older, which is the likelier original.
       -- A pre-invited canonical is always emitted — it can never mirror,
       -- because only self-registered guests appear in `dupes`.
       and (
             not c.self_registered
          or (d.created_at, d.id) > (c.created_at, c.id)
           )
       -- Never offer to merge a guest into another guest already dismissed
       -- against it, in either direction.
       and not exists (
             select 1 from public.duplicate_dismissals x
              where x.guest_a_id = least(d.id, c.id)
                and x.guest_b_id = greatest(d.id, c.id)
           )
  ),
  ranked as (
    select p.*,
           row_number() over (
             partition by p.duplicate_id
             order by p.canonical_self_registered asc,
                      p.similarity desc,
                      p.canonical_name asc
           ) as rn
      from pairs p
  )
  select duplicate_id, duplicate_name, duplicate_created_at,
         canonical_id, canonical_name, similarity, match_kind
    from ranked
   where rn <= 3
   order by duplicate_name asc, rn asc;
$$;

comment on function public.get_duplicate_candidates() is
  'Couple-only. Lists self-registered primaries that look like an existing guest (normalized-equal or trigram >= 0.55), best 3 canonicals each, excluding dismissed pairs. Helper-gated in the WHERE clause — returns zero rows rather than raising, matching get_budget_config (0006).';

revoke all on function public.get_duplicate_candidates() from public, anon;
grant execute on function public.get_duplicate_candidates() to authenticated;

-- ── 5. dismiss_duplicate_pair — couple-only ───────────────────────────────────
drop function if exists public.dismiss_duplicate_pair(uuid, uuid);

create function public.dismiss_duplicate_pair(p_guest_a uuid, p_guest_b uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- security definer bypasses RLS, so the couple-only gate must be enforced
  -- here too — otherwise a helper could call this RPC directly.
  if (select public.is_helper()) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if p_guest_a is null or p_guest_b is null or p_guest_a = p_guest_b then
    raise exception 'invalid guest pair';
  end if;

  insert into public.duplicate_dismissals (guest_a_id, guest_b_id)
  values (least(p_guest_a, p_guest_b), greatest(p_guest_a, p_guest_b))
  on conflict do nothing;
end;
$$;

comment on function public.dismiss_duplicate_pair(uuid, uuid) is
  'Couple-only. Records that two guests are NOT duplicates so get_duplicate_candidates stops offering the pair. Ids are stored canonically (least, greatest).';

revoke all on function public.dismiss_duplicate_pair(uuid, uuid) from public, anon;
grant execute on function public.dismiss_duplicate_pair(uuid, uuid) to authenticated;

-- ── 6. RSVP-email suppression guard ───────────────────────────────────────────
-- notify_rsvp_status_change (0007) fires an outbound HTTP email on ANY
-- rsvp_status change. A merge can move the canonical from pending to confirmed,
-- which would email the guest a confirmation they did not just trigger. Recreate
-- the trigger function with a transaction-local opt-out that merge_guests sets.
--
-- Unchanged from 0007 apart from the guard — kept as a full body (not an ALTER)
-- so the final form of the function is readable in one place.
create or replace function public.notify_rsvp_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  -- Set transaction-locally by merge_guests (0011): an administrative merge must
  -- not look like the guest changing their own RSVP. current_setting(.., true)
  -- returns null rather than raising when the setting was never set.
  if coalesce(current_setting('app.suppress_rsvp_email', true), '') = 'on' then
    return new;
  end if;

  if new.rsvp_status is distinct from old.rsvp_status
     and new.rsvp_status in ('confirmed', 'declined')
     and new.email != '' then

    select decrypted_secret into v_url
      from vault.decrypted_secrets where name = 'rsvp_email_webhook_url';
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'rsvp_email_webhook_secret';

    if v_url is not null and v_secret is not null then
      perform net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
          'Content-Type',    'application/json',
          'x-webhook-secret', v_secret
        ),
        body    := jsonb_build_object(
          'guest_id',        new.id,
          'old_rsvp_status', old.rsvp_status
        )
      );
    end if;
  end if;

  return new;
end;
$$;

-- ── 7. merge_guests — couple-only, atomic ─────────────────────────────────────
-- Folds p_duplicate_id into p_canonical_id and deletes the duplicate.
--
-- Semantics: the canonical wins every field it has a value for; the duplicate
-- fills blanks only. Per-event RSVP answers reconcile newest-first (the walk-in
-- row is usually the guest's own latest word). Nothing is lost silently — the
-- deleted row, its event answers, its plus-ones, and any plus-one dropped to the
-- 6-child cap are all snapshotted into guest_merges first.
--
-- Statement ORDER is load-bearing; see the numbered comments. In particular
-- children must be reparented BEFORE the delete, because guests.primary_guest_id
-- is ON DELETE CASCADE (0002) and would otherwise destroy them.
drop function if exists public.merge_guests(uuid, uuid);

create function public.merge_guests(p_canonical_id uuid, p_duplicate_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canonical      public.guests%rowtype;
  v_duplicate      public.guests%rowtype;
  v_audit_id       uuid;
  v_children       jsonb := '[]'::jsonb;
  v_dropped        jsonb := '[]'::jsonb;
  v_event_rsvps    jsonb := '[]'::jsonb;
  v_capacity       int;
  v_dup_draw       int;
  v_move_ids       uuid[];
  v_party          text;
begin
  -- 1. Couple-only. security definer bypasses RLS, so the gate lives here.
  if (select public.is_helper()) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if p_canonical_id is null or p_duplicate_id is null then
    raise exception 'invalid guest pair';
  end if;
  if p_canonical_id = p_duplicate_id then
    raise exception 'cannot merge a guest into itself';
  end if;

  -- 2. Lock both rows in a deterministic order so two concurrent merges over the
  -- same pair cannot deadlock.
  perform 1 from public.guests
    where id in (p_canonical_id, p_duplicate_id)
    order by id
    for update;

  select * into v_canonical from public.guests where id = p_canonical_id;
  if not found then raise exception 'canonical guest not found'; end if;

  select * into v_duplicate from public.guests where id = p_duplicate_id;
  if not found then raise exception 'duplicate guest not found'; end if;

  -- Merging a plus-one would orphan it from its party; the UI only ever offers
  -- primaries, but the RPC is the real boundary.
  if v_canonical.primary_guest_id is not null or v_duplicate.primary_guest_id is not null then
    raise exception 'can only merge primary guests';
  end if;

  -- 3. Suppress the RSVP confirmation email for this transaction. An
  -- administrative merge must not look like the guest changing their own RSVP.
  perform set_config('app.suppress_rsvp_email', 'on', true);

  -- 4. Snapshot everything the delete will take with it, BEFORE touching it.
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_event_rsvps
    from public.guest_event_rsvps r where r.guest_id = p_duplicate_id;

  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_children
    from public.guests c where c.primary_guest_id = p_duplicate_id;

  insert into public.guest_merges (
    canonical_guest_id, canonical_name, merged_guest_snapshot,
    merged_event_rsvps, merged_children, merged_by
  ) values (
    p_canonical_id, v_canonical.name, to_jsonb(v_duplicate),
    v_event_rsvps, v_children, coalesce(auth.email(), '')
  )
  returning id into v_audit_id;

  -- 5. Fill blanks on the canonical from the duplicate. The canonical wins every
  -- field it already has a value for. rsvp_status is special-cased: 'pending' is
  -- the default (i.e. "no answer yet"), so a real answer may fill it, but a
  -- duplicate that never answered can never regress a confirmed guest.
  -- Mirrored by mergePreview() in src/lib/guestDedupe.js.
  update public.guests c set
    rsvp_status        = case when c.rsvp_status = 'pending' and v_duplicate.rsvp_status <> 'pending'
                              then v_duplicate.rsvp_status else c.rsvp_status end,
    rsvp_at            = case when c.rsvp_status = 'pending' and v_duplicate.rsvp_status <> 'pending'
                              then v_duplicate.rsvp_at else c.rsvp_at end,
    meal_choice        = case when c.meal_choice        = '' then v_duplicate.meal_choice        else c.meal_choice        end,
    dietary_notes      = case when c.dietary_notes      = '' then v_duplicate.dietary_notes      else c.dietary_notes      end,
    phone              = case when c.phone              = '' then v_duplicate.phone              else c.phone              end,
    email              = case when c.email              = '' then v_duplicate.email              else c.email              end,
    plus_one_name      = case when c.plus_one_name      = '' then v_duplicate.plus_one_name      else c.plus_one_name      end,
    rsvp_message       = case when c.rsvp_message       = '' then v_duplicate.rsvp_message       else c.rsvp_message       end,
    notes              = case when coalesce(c.notes, '') = '' then v_duplicate.notes             else c.notes              end,
    relationship_group = case when c.relationship_group = '' then v_duplicate.relationship_group else c.relationship_group end,
    friend_subgroup    = case when c.friend_subgroup    = '' then v_duplicate.friend_subgroup    else c.friend_subgroup    end,
    wants_to_speak     = case when c.wants_to_speak     = '' then v_duplicate.wants_to_speak     else c.wants_to_speak     end,
    party              = case when c.party              = '' then v_duplicate.party              else c.party              end,
    -- Seating is denormalized across two columns kept in sync (AdminApp
    -- resetSeating) — copy them together, and only when the canonical is
    -- genuinely unseated and the duplicate genuinely is seated.
    table_id           = case when c.table_id is null and v_duplicate.table_id is not null
                              then v_duplicate.table_id else c.table_id end,
    table_number       = case when c.table_id is null and v_duplicate.table_id is not null
                              then v_duplicate.table_number else c.table_number end,
    -- D-Day state. Never cleared by the merge: a walk-in who was checked in and
    -- handed over an ang-bao must not be un-checked-in administratively.
    -- Mirrored by MERGE_CARRY_FIELDS in src/lib/guestDedupe.js.
    checked_in         = c.checked_in    or v_duplicate.checked_in,
    checked_in_at      = coalesce(c.checked_in_at, v_duplicate.checked_in_at),
    angbao_given       = c.angbao_given  or v_duplicate.angbao_given,
    angbao_amount      = case when c.angbao_amount = 0 then v_duplicate.angbao_amount else c.angbao_amount end,
    is_vip             = c.is_vip        or v_duplicate.is_vip
  where c.id = p_canonical_id;

  -- 6. Per-event answers, newest wins. guest_event_rsvps is keyed by
  -- (guest_id, event_id), so a blind reparent would raise a duplicate-key error
  -- on every event both guests answered. Update the overlap first, then move
  -- only the non-overlapping rows; whatever remains cascades away with the row.
  update public.guest_event_rsvps c set
    status        = d.status,
    meal_choice   = d.meal_choice,
    dietary_notes = d.dietary_notes,
    responded_at  = d.responded_at
    from public.guest_event_rsvps d
   where c.guest_id = p_canonical_id
     and d.guest_id = p_duplicate_id
     and c.event_id = d.event_id
     and coalesce(d.responded_at, '-infinity'::timestamptz)
       > coalesce(c.responded_at, '-infinity'::timestamptz);

  update public.guest_event_rsvps
     set guest_id = p_canonical_id
   where guest_id = p_duplicate_id
     and event_id not in (
           select event_id from public.guest_event_rsvps where guest_id = p_canonical_id
         );

  -- 7. Reparent plus-ones BEFORE the delete — primary_guest_id is ON DELETE
  -- CASCADE, so deleting first would destroy them. Drop any whose name the
  -- canonical already has, then apply the 6-child cap deliberately (the public
  -- RSVP path truncates to 6 silently) and record what was dropped.
  -- Mirrored by childMergePlan() in src/lib/guestDedupe.js.
  select greatest(0, 6 - count(*))::int into v_capacity
    from public.guests where primary_guest_id = p_canonical_id;

  -- Which children may move: named, not already present on the canonical under
  -- the same normalized name, oldest first, up to the remaining capacity.
  select coalesce(array_agg(s.id order by s.rn), '{}'::uuid[]) into v_move_ids
    from (
      select c.id, row_number() over (order by c.created_at, c.id) as rn
        from public.guests c
       where c.primary_guest_id = p_duplicate_id
         and public.normalize_guest_name(c.name) <> ''
         and not exists (
               select 1 from public.guests e
                where e.primary_guest_id = p_canonical_id
                  and public.normalize_guest_name(e.name) = public.normalize_guest_name(c.name)
             )
    ) s
   where s.rn <= v_capacity;

  -- Snapshot the ones that will NOT move before the delete cascades them away.
  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into v_dropped
    from public.guests d
   where d.primary_guest_id = p_duplicate_id
     and not (d.id = any(v_move_ids));

  update public.guest_merges set dropped_children = v_dropped where id = v_audit_id;

  -- Re-read the canonical's party: step 5 may have just filled it from the
  -- duplicate, and children's party is force-synced to their primary's
  -- (0002_rsvp_seating.sql:264).
  select party into v_party from public.guests where id = p_canonical_id;

  update public.guests
     set primary_guest_id = p_canonical_id,
         party            = v_party
   where id = any(v_move_ids);

  -- 8. submissions.matched_guest_id is ON DELETE SET NULL, so an approved ang-bao
  -- submission would silently unlink itself. Repoint it instead.
  update public.submissions
     set matched_guest_id = p_canonical_id
   where matched_guest_id = p_duplicate_id;

  -- 9. draw_number is UNIQUE, so the transfer has to free the duplicate's value
  -- before assigning it. Only when the canonical has none — never overwrite a
  -- number already drawn.
  v_dup_draw := v_duplicate.draw_number;
  if v_canonical.draw_number is null and v_dup_draw is not null then
    update public.guests set draw_number = null where id = p_duplicate_id;
    update public.guests set draw_number = v_dup_draw where id = p_canonical_id;
  end if;

  -- 10. Finally, the delete. Its cascades are now harmless: children have been
  -- reparented, and the only guest_event_rsvps rows left are ones the canonical
  -- already had a newer answer for.
  delete from public.guests where id = p_duplicate_id;

  -- 11. Dismissals referencing the duplicate cascade away with it (FK on delete
  -- cascade), so no explicit cleanup is needed.
  return v_audit_id;
end;
$$;

comment on function public.merge_guests(uuid, uuid) is
  'Couple-only, atomic. Folds the duplicate guest into the canonical (canonical wins every populated field; duplicate fills blanks; per-event answers reconcile newest-first) and deletes it, after snapshotting the full row + event answers + plus-ones into guest_merges. Suppresses the RSVP confirmation email for the transaction. Statement order is load-bearing — read the numbered comments before editing.';

revoke all on function public.merge_guests(uuid, uuid) from public, anon;
grant execute on function public.merge_guests(uuid, uuid) to authenticated;
