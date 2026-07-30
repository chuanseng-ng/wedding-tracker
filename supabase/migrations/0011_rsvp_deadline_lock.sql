-- ─────────────────────────────────────────────────────────────────────────────
-- 0011_rsvp_deadline_lock.sql — close the RSVP form after the deadline (#179)
--
-- weddings.rsvp_deadline has been decorative since 0003: the public page prints
-- "RSVP by 31 Oct" and nothing enforces it, so a guest can still submit — or
-- silently CHANGE — an answer after the couple has arranged seating.
--
-- Adds an opt-in lock. When weddings.lock_rsvp_after_deadline is on and the
-- deadline day has ended, every anon-facing RSVP write RPC refuses with
-- 'rsvp closed' and the public form renders a notice instead (src/rsvp/RsvpPage.jsx).
-- Enforcement lives HERE, not only in the UI: the anon key can call these RPCs
-- directly. Couple/helper edits go straight to the guests table and are untouched.
--
-- "The deadline day has ended" is a CALENDAR question about a bare `date`, so it
-- is resolved in weddings.wedding_timezone rather than the server's UTC clock —
-- otherwise a UTC-hosted deployment locks a UTC-5 couple's guests out five hours
-- early. Mirrored in JS by src/lib/rsvpDeadline.js (isRsvpLocked).
--
-- Idempotent: guarded column adds, guarded constraint, functions dropped and
-- recreated. submit_rsvp / submit_rsvp_events / register_open_rsvp are reproduced
-- in full from 0002 / 0004 / 0008 with only the guard added — Postgres has no way
-- to patch a function body. A later consolidation round folds them back.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. weddings columns ───────────────────────────────────────────────────────
alter table public.weddings
  add column if not exists lock_rsvp_after_deadline boolean not null default false;
alter table public.weddings
  add column if not exists wedding_timezone text not null default 'Asia/Singapore';

-- No CHECK constraint on wedding_timezone: a CHECK expression cannot contain a
-- subquery, so it cannot consult pg_timezone_names, and hardcoding a zone list
-- would rot. Validation is enforced on the way IN (upsert_wedding_page clamps an
-- unknown zone) and tolerated on the way OUT (is_rsvp_locked falls back rather
-- than raising), so a hand-edited row can never break the public form.

comment on column public.weddings.lock_rsvp_after_deadline is
  'Opt-in (#179): when true and rsvp_deadline has passed in wedding_timezone, the public RSVP write RPCs refuse with ''rsvp closed'' and the form renders a closed notice. Off reproduces the pre-#179 always-open behaviour. Admin-side guest edits are never affected.';
comment on column public.weddings.wedding_timezone is
  'IANA zone deciding WHEN rsvp_deadline (a bare date) is considered past — see public.is_rsvp_locked(). Defaults to Asia/Singapore; validated by upsert_wedding_page, not by a CHECK. Mirrored in JS by src/lib/rsvpDeadline.js.';

-- ── 2. is_rsvp_locked — the single source of truth for the cutoff ─────────────
-- security definer: the weddings_select RLS policy is couple-only (0010), so the
-- anon-facing RPCs below could not read the row themselves.
--
-- FAILS OPEN, like is_helper() (0001): no wedding row, no deadline, or the flag
-- off all yield false. A misconfigured deployment must never silently shut the
-- form — the failure mode of locking too eagerly is far worse than of not locking.
--
-- The deadline day is INCLUSIVE: `>` means locking begins at local midnight after it.
drop function if exists public.is_rsvp_locked();

create function public.is_rsvp_locked()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lock     boolean;
  v_deadline date;
  v_tz       text;
  v_today    date;
begin
  select coalesce(lock_rsvp_after_deadline, false),
         rsvp_deadline,
         coalesce(nullif(trim(wedding_timezone), ''), 'Asia/Singapore')
    into v_lock, v_deadline, v_tz
  from public.weddings limit 1;

  -- No wedding row → v_lock is null → open. Flag off or no deadline → open.
  if not coalesce(v_lock, false) or v_deadline is null then
    return false;
  end if;

  -- A zone the server does not recognise raises rather than returning null, so
  -- catch it: a bad setting must not take the public form down. Mirrors the
  -- try/catch fallback in src/lib/rsvpDeadline.js zonedDateISO.
  begin
    v_today := (now() at time zone v_tz)::date;
  exception when others then
    v_today := (now() at time zone 'Asia/Singapore')::date;
  end;

  return v_today > v_deadline;
end;
$$;

comment on function public.is_rsvp_locked() is
  'True when the couple enabled lock_rsvp_after_deadline AND rsvp_deadline has passed in wedding_timezone (#179). Fails open. Guards submit_rsvp, submit_rsvp_events and register_open_rsvp, and is surfaced to clients as get_wedding_config().rsvp_locked.';

-- Not granted to anon: only the security-definer RPCs below and
-- get_wedding_config (itself definer) call it. Clients read rsvp_locked instead.
revoke all on function public.is_rsvp_locked() from public, anon;
grant execute on function public.is_rsvp_locked() to authenticated;

-- ── 3. submit_rsvp — reproduced from 0002 §4a with the deadline guard ────────
drop function if exists public.submit_rsvp(uuid, text, text, text, text, text, text);
drop function if exists public.submit_rsvp(uuid, text, text, text, text, text, text, text, text);
drop function if exists public.submit_rsvp(uuid, text, text, text, text, text, text, text, text, text);
drop function if exists public.submit_rsvp(uuid, text, text, text, text, text, text, text, text, text, text);

create or replace function public.submit_rsvp(
  p_token              uuid,
  p_status             text,
  p_meal_choice        text default '',
  p_plus_one_name      text default '',
  p_dietary_notes      text default '',
  p_relationship_group text default '',
  p_friend_subgroup    text default '',
  p_party              text default '',
  p_message            text default '',
  p_email              text default '',
  p_wants_to_speak     text default '',
  p_plus_one_names     text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valid_groups  text[] := array['family', 'colleagues', 'friends', 'other', 'complicated', ''];
  v_valid_friends text[] := array['army', 'primary_school', 'secondary_school', 'tertiary', 'university', 'other', 'secret', ''];
  v_valid_parties text[] := array['bride', 'groom', ''];
  v_primary_id    uuid;
  v_party         text;
  v_clean         text[];
begin
  -- #179: the couple locked the form once the RSVP deadline passed. Checked
  -- FIRST so no partial write happens, and here rather than only in the UI
  -- because anon can call this RPC directly with the public key.
  if public.is_rsvp_locked() then
    raise exception 'rsvp closed';
  end if;

  if p_status not in ('confirmed', 'declined') then
    raise exception 'invalid rsvp status: %', p_status;
  end if;

  update public.guests set
    rsvp_status        = p_status,
    rsvp_at            = now(),
    meal_choice        = left(coalesce(p_meal_choice, ''), 60),
    plus_one_name      = left(coalesce(p_plus_one_name, ''), 120),
    dietary_notes      = left(coalesce(p_dietary_notes, ''), 500),
    relationship_group = case
      when p_relationship_group = any(v_valid_groups) then p_relationship_group
      else relationship_group
    end,
    friend_subgroup    = case
      when p_relationship_group = 'friends' and p_friend_subgroup = any(v_valid_friends)
        then p_friend_subgroup
      when p_relationship_group = any(v_valid_groups) and p_relationship_group != 'friends'
        then ''
      else friend_subgroup
    end,
    party              = case
      when p_party = any(v_valid_parties) and p_party != '' then p_party
      else party
    end,
    rsvp_message       = left(coalesce(p_message, ''), 500),
    email              = case
      when p_email != '' then left(coalesce(p_email, ''), 254)
      else email
    end,
    wants_to_speak     = case
      when p_wants_to_speak in ('', 'yes', 'no') then p_wants_to_speak
      else wants_to_speak
    end
  where rsvp_token = p_token;

  if not found then
    raise exception 'invalid rsvp token';
  end if;

  -- ── Plus-x reconciliation (#38) ──────────────────────────────────────────
  -- Resolve the primary and the party it should be filed under.
  select id,
         case when p_party = any(v_valid_parties) and p_party != '' then p_party else party end
    into v_primary_id, v_party
  from public.guests where rsvp_token = p_token;

  -- Clean requested names: trim, drop blanks, cap length, dedupe, cap at 6.
  select coalesce(array_agg(nm), '{}')
    into v_clean
  from (
    select distinct left(trim(n), 120) as nm
    from unnest(coalesce(p_plus_one_names, '{}')) as t(n)
    where trim(coalesce(n, '')) <> ''
  ) d;
  if array_length(v_clean, 1) > 6 then
    v_clean := v_clean[1:6];
  end if;

  -- Remove children no longer listed (preserves table/check-in for kept names).
  delete from public.guests
  where primary_guest_id = v_primary_id
    and lower(trim(name)) <> all (select lower(x) from unnest(v_clean) as x);

  -- Keep kept children's party in sync with the primary's current side.
  update public.guests
  set party = v_party
  where primary_guest_id = v_primary_id;

  -- Add newly-listed names not already present as a child of this primary.
  insert into public.guests (name, primary_guest_id, party, rsvp_status)
  select nm, v_primary_id, v_party, p_status
  from unnest(v_clean) as nm
  where lower(trim(nm)) not in (
    select lower(trim(name)) from public.guests where primary_guest_id = v_primary_id
  );
end;
$$;

grant execute on function public.submit_rsvp(uuid, text, text, text, text, text, text, text, text, text, text, text[]) to anon, authenticated;

-- ── 4. submit_rsvp_events — reproduced from 0004 §7 with the deadline guard ──
drop function if exists public.submit_rsvp_events(uuid, text, text, text, text, text, text, text[], jsonb);

create or replace function public.submit_rsvp_events(
  p_token              uuid,
  p_email              text   default '',
  p_message            text   default '',
  p_wants_to_speak     text   default '',
  p_relationship_group text   default '',
  p_friend_subgroup    text   default '',
  p_party              text   default '',
  p_plus_one_names     text[] default '{}',
  p_event_responses    jsonb  default '[]'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valid_groups  text[] := array['family', 'colleagues', 'friends', 'other', 'complicated', ''];
  v_valid_friends text[] := array['army', 'primary_school', 'secondary_school', 'tertiary', 'university', 'other', 'secret', ''];
  v_valid_parties text[] := array['bride', 'groom', ''];
  v_primary_id    uuid;
  v_party         text;
  v_clean         text[];
  v_invited       uuid[];
  v_invited_all   uuid[];
  v_resp          jsonb;
  v_body_name     text;
  v_event_id      uuid;
  v_status        text;
  v_meal          text;
  v_dietary       text;
  v_target_id     uuid;
  v_requires_meal boolean;
  v_enabled       boolean;
  v_meal_event    uuid;
begin
  -- #179: the couple locked the form once the RSVP deadline passed. Checked
  -- FIRST so no partial write happens, and here rather than only in the UI
  -- because anon can call this RPC directly with the public key.
  if public.is_rsvp_locked() then
    raise exception 'rsvp closed';
  end if;

  -- 1. Resolve the primary + the party side it should be filed under.
  select id,
         case when p_party = any(v_valid_parties) and p_party <> '' then p_party else party end
    into v_primary_id, v_party
  from public.guests where rsvp_token = p_token;

  if v_primary_id is null then
    raise exception 'invalid rsvp token';
  end if;

  -- Reject a malformed payload before iterating (a non-array would otherwise
  -- error inside jsonb_array_elements), then bound its size (cheap DoS guard).
  if jsonb_typeof(coalesce(p_event_responses, '[]'::jsonb)) <> 'array' then
    raise exception 'event responses must be an array';
  end if;
  if jsonb_array_length(coalesce(p_event_responses, '[]'::jsonb)) > 100 then
    raise exception 'too many event responses';
  end if;

  -- Smart-RSVP submit is a no-op unless the feature is enabled (the public form
  -- uses the legacy submit_rsvp when OFF). Load the flag + designated meal event.
  select coalesce(enable_smart_rsvp, false), primary_meal_event_id
    into v_enabled, v_meal_event
  from public.weddings limit 1;
  if not coalesce(v_enabled, false) then
    return;
  end if;

  -- 2. Update the primary's non-event fields (attendance is mirrored from events).
  update public.guests set
    email = case when p_email <> '' then left(p_email, 254) else email end,
    rsvp_message = left(coalesce(p_message, ''), 500),
    wants_to_speak = case when p_wants_to_speak in ('', 'yes', 'no') then p_wants_to_speak else wants_to_speak end,
    relationship_group = case
      when p_relationship_group = any(v_valid_groups) then p_relationship_group
      else relationship_group end,
    friend_subgroup = case
      when p_relationship_group = 'friends' and p_friend_subgroup = any(v_valid_friends) then p_friend_subgroup
      when p_relationship_group = any(v_valid_groups) and p_relationship_group <> 'friends' then ''
      else friend_subgroup end,
    party = case
      when p_party = any(v_valid_parties) and p_party <> '' then p_party else party end
  where id = v_primary_id;

  -- 3. Plus-x reconciliation (same rules as submit_rsvp): trim, dedupe, cap 6.
  select coalesce(array_agg(nm), '{}') into v_clean
  from (
    select distinct left(trim(n), 120) as nm
    from unnest(coalesce(p_plus_one_names, '{}')) as t(n)
    where trim(coalesce(n, '')) <> ''
  ) d;
  if array_length(v_clean, 1) > 6 then
    v_clean := v_clean[1:6];
  end if;

  delete from public.guests
  where primary_guest_id = v_primary_id
    and lower(trim(name)) <> all (select lower(x) from unnest(v_clean) as x);

  update public.guests set party = v_party where primary_guest_id = v_primary_id;

  insert into public.guests (name, primary_guest_id, party, rsvp_status)
  select nm, v_primary_id, v_party, 'pending'
  from unnest(v_clean) as nm
  where lower(trim(nm)) not in (
    select lower(trim(name)) from public.guests where primary_guest_id = v_primary_id
  );

  -- 4. The primary's invited event set. Two views:
  --    v_invited      → ACTIVE invited events, used for materialization + the
  --                     self-elevation guard (matches get_guest_by_rsvp_token's
  --                     read path, so a stale/deactivated event can't be written).
  --    v_invited_all  → ALL invited events (active or not), used only for pruning,
  --                     so a merely deactivated (but still invited) event keeps its
  --                     child rows / response history.
  select coalesce(array_agg(ger.event_id) filter (where e.is_active), '{}'),
         coalesce(array_agg(ger.event_id), '{}')
    into v_invited, v_invited_all
  from public.guest_event_rsvps ger
  join public.wedding_events e on e.id = ger.event_id
  where ger.guest_id = v_primary_id and ger.invited;

  -- 5. Materialize a junction row per child × per active invited event. Seed the
  --    initial status/meal from the child's existing LEGACY RSVP so enrolling a
  --    guest who already answered under the old flow doesn't regress them to
  --    pending via the mirror trigger. `on conflict do nothing` leaves existing
  --    per-event rows untouched (re-submits never re-seed).
  insert into public.guest_event_rsvps (
    guest_id, event_id, invited, status, meal_choice, dietary_notes, responded_at
  )
  select
    c.id,
    e,
    true,
    case when c.rsvp_status in ('confirmed', 'declined') then c.rsvp_status else 'pending' end,
    case when c.rsvp_status = 'confirmed' and v_meal_event = e
         then left(coalesce(c.meal_choice, ''), 60) else '' end,
    case when c.rsvp_status = 'confirmed' and v_meal_event = e
         then left(coalesce(c.dietary_notes, ''), 500) else '' end,
    case when c.rsvp_status in ('confirmed', 'declined') then c.rsvp_at else null end
  from public.guests c
  cross join unnest(v_invited) as e
  where c.primary_guest_id = v_primary_id
  on conflict (guest_id, event_id) do nothing;

  -- 6. Prune child junctions for events the primary is no longer invited to at all
  --    (an un-invite, not a mere deactivation).
  delete from public.guest_event_rsvps
  where guest_id in (select id from public.guests where primary_guest_id = v_primary_id)
    and event_id <> all (v_invited_all);

  -- 7. Apply per-body, per-event responses.
  for v_resp in select value from jsonb_array_elements(coalesce(p_event_responses, '[]'::jsonb))
  loop
    v_body_name := coalesce(v_resp->>'body_name', '');
    begin
      v_event_id := (v_resp->>'event_id')::uuid;
    exception when others then
      continue;  -- malformed event id
    end;

    v_status := coalesce(v_resp->>'status', '');
    if v_status not in ('confirmed', 'declined') then
      continue;  -- ignore pending / invalid
    end if;

    -- Self-elevation guard: only events the party is invited to.
    if not (v_event_id = any(v_invited)) then
      continue;
    end if;

    -- Resolve the target body. The primary is identified by a blank body_name OR
    -- an explicit is_primary flag (get_guest_by_rsvp_token emits the primary with
    -- its own name + is_primary=true, so a round-tripped primary response matches).
    if trim(v_body_name) = '' or coalesce(v_resp->>'is_primary', 'false') = 'true' then
      v_target_id := v_primary_id;
    else
      select id into v_target_id
      from public.guests
      where primary_guest_id = v_primary_id and lower(trim(name)) = lower(trim(v_body_name))
      limit 1;
      if v_target_id is null then
        continue;  -- unknown / de-listed body
      end if;
    end if;

    -- Meal only for a confirmed response on a meal-bearing event.
    select requires_meal into v_requires_meal from public.wedding_events where id = v_event_id;
    v_meal := case
      when v_status = 'confirmed' and coalesce(v_requires_meal, false)
        then left(coalesce(v_resp->>'meal_choice', ''), 60)
      else '' end;
    v_dietary := left(coalesce(v_resp->>'dietary_notes', ''), 500);

    update public.guest_event_rsvps set
      status        = v_status,
      meal_choice   = v_meal,
      dietary_notes = v_dietary,
      responded_at  = now()
    where guest_id = v_target_id and event_id = v_event_id and invited;
  end loop;
end;
$$;

grant execute on function public.submit_rsvp_events(uuid, text, text, text, text, text, text, text[], jsonb)
  to anon, authenticated;

-- ── 5. register_open_rsvp — reproduced from 0008 §3 with the deadline guard ──
-- Guarded too: open mode is a submit path, so an unguarded register would create
-- a guest row for someone the form is about to refuse.
drop function if exists public.register_open_rsvp(text, text);

create function public.register_open_rsvp(p_name text, p_pin text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_smart   boolean;
  v_pin     text;
  v_name    text;
  v_id      uuid;
  v_token   uuid;
begin
  -- #179: the couple locked the form once the RSVP deadline passed. Checked
  -- FIRST so no partial write happens, and here rather than only in the UI
  -- because anon can call this RPC directly with the public key.
  if public.is_rsvp_locked() then
    raise exception 'rsvp closed';
  end if;

  select coalesce(w.enable_open_rsvp, false),
         coalesce(w.enable_smart_rsvp, false),
         trim(coalesce(w.rsvp_pin, ''))
    into v_enabled, v_smart, v_pin
    from public.weddings w
    limit 1;

  -- The PIN is mandatory for open mode; enabled-with-blank-pin (only reachable
  -- by editing the row outside upsert_wedding_config) fails closed.
  if not coalesce(v_enabled, false) or v_pin = '' then
    raise exception 'open rsvp disabled';
  end if;

  if (select count(*) from public.open_rsvp_pin_attempts
      where attempted_at > now() - interval '15 minutes') >= 20 then
    return jsonb_build_object('error', 'too_many_attempts');
  end if;

  if trim(coalesce(p_pin, '')) <> v_pin then
    delete from public.open_rsvp_pin_attempts
      where attempted_at < now() - interval '1 day';
    insert into public.open_rsvp_pin_attempts default values;
    return jsonb_build_object('error', 'invalid_pin');
  end if;

  v_name := left(trim(coalesce(p_name, '')), 120);
  if char_length(v_name) < 1 then
    raise exception 'invalid name';
  end if;

  -- Reuse an existing primary guest with the same cleaned name
  -- (case-insensitive) instead of inserting a duplicate.
  select g.id, g.rsvp_token
    into v_id, v_token
    from public.guests g
   where g.primary_guest_id is null
     and lower(trim(g.name)) = lower(v_name)
   order by g.created_at
   limit 1;

  if v_id is null then
    -- Cheap abuse guard on top of the PIN: cap total self-registered rows.
    if (select count(*) from public.guests where self_registered) >= 1000 then
      raise exception 'guest limit reached';
    end if;

    insert into public.guests (name, self_registered)
    values (v_name, true)
    returning id, rsvp_token into v_id, v_token;
  end if;

  -- Smart mode: a self-registered guest is invited to all active events so
  -- submit_rsvp_events accepts their answers. Only when the guest has no
  -- invitation rows at all — a matched pre-invited guest keeps the couple's
  -- curated set. Per the enrollment contract (0004 §2), seed status/meal from
  -- the guest's legacy answer so the mirror trigger can't regress a
  -- previously-confirmed guest to pending.
  if v_smart and not exists (
    select 1 from public.guest_event_rsvps ger where ger.guest_id = v_id
  ) then
    insert into public.guest_event_rsvps
      (guest_id, event_id, invited, status, meal_choice, responded_at)
    select v_id, e.id, true, g.rsvp_status, g.meal_choice, g.rsvp_at
      from public.wedding_events e
     cross join public.guests g
     where e.is_active and g.id = v_id
    on conflict (guest_id, event_id) do nothing;
  end if;

  return jsonb_build_object('token', v_token);
end;
$$;

-- Anon-callable by design: it exposes nothing beyond a token for the caller's
-- own typed name (strictly less than find_guest_by_name reveals, and only
-- behind the PIN), and every write it performs is bounded and sanitized.
revoke all on function public.register_open_rsvp(text, text) from public;
grant execute on function public.register_open_rsvp(text, text) to anon, authenticated;

-- ── 6. upsert_wedding_page — carries the two new settings ────────────────────
-- Reproduced from 0003 §4 with p_lock_rsvp_after_deadline / p_wedding_timezone
-- appended. Parameters are append-only; the superseded 18-arg overload is dropped
-- so PostgREST RPC resolution stays unambiguous.

drop function if exists public.upsert_wedding_page(text, text, text, text, jsonb, date, boolean, text);
drop function if exists public.upsert_wedding_page(text, text, text, text, jsonb, date, boolean, text, text);
drop function if exists public.upsert_wedding_page(text, text, text, text, jsonb, date, boolean, text, text, text);
drop function if exists public.upsert_wedding_page(text, text, text, text, jsonb, date, boolean, text, text, text, boolean);
drop function if exists public.upsert_wedding_page(text, text, text, text, jsonb, date, boolean, text, text, text, boolean, text, text);
drop function if exists public.upsert_wedding_page(text, text, text, text, jsonb, date, boolean, text, text, text, boolean, text, text, jsonb);
drop function if exists public.upsert_wedding_page(text, text, text, text, jsonb, date, boolean, text, text, text, boolean, text, text, jsonb, jsonb);
drop function if exists public.upsert_wedding_page(text, text, text, text, jsonb, date, boolean, text, text, text, boolean, text, text, jsonb, jsonb, jsonb);
drop function if exists public.upsert_wedding_page(text, text, text, text, jsonb, date, boolean, text, text, text, boolean, text, text, jsonb, jsonb, jsonb, text);
drop function if exists public.upsert_wedding_page(text, text, text, text, jsonb, date, boolean, text, text, text, boolean, text, text, jsonb, jsonb, jsonb, text, text);

create or replace function public.upsert_wedding_page(
  p_slug            text,
  p_love_story      text,
  p_dress_code      text,
  p_hero_image_url  text,
  p_fun_qa          jsonb,
  p_rsvp_deadline   date,
  p_is_published    boolean,
  p_meal_options    text,
  p_getting_there   text default '',
  p_theme           text default 'minimal',
  p_enable_fun_rsvp_options boolean default false,
  p_smoking_notice  text default '',
  p_parking_notice  text default '',
  p_content_translations jsonb default '{}',
  p_theme_tokens    jsonb default '{}',
  p_section_photos  jsonb default '{}',
  p_hero_focal_point text default 'center',
  p_extra_notice    text default '',
  p_lock_rsvp_after_deadline boolean default false,
  p_wedding_timezone text default 'Asia/Singapore'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- An unknown zone is clamped rather than allowed to trip weddings_timezone_check:
  -- a stale client must not be able to fail the couple's whole page save.
  v_tz text := case
    when exists (select 1 from pg_timezone_names z where z.name = p_wedding_timezone)
      then p_wedding_timezone
    else 'Asia/Singapore'
  end;
begin
  -- Couple-only: security definer bypasses the weddings_write RLS policy, so
  -- the role gate must live inside the function (same pattern as
  -- upsert_budget_config in 0006).
  if (select public.is_helper()) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  insert into public.weddings (
    bride_name, groom_name,
    slug, love_story, dress_code, hero_image_url, hero_focal_point,
    fun_qa, rsvp_deadline, is_published, meal_options,
    getting_there, theme, enable_fun_rsvp_options,
    smoking_notice, parking_notice, extra_notice, content_translations, theme_tokens,
    section_photos, lock_rsvp_after_deadline, wedding_timezone, updated_at
  ) values (
    '', '',
    p_slug,
    left(coalesce(p_love_story, ''), 5000),
    left(coalesce(p_dress_code, ''), 200),
    left(coalesce(p_hero_image_url, ''), 500),
    coalesce(p_hero_focal_point, 'center'),
    coalesce(p_fun_qa, '[]'::jsonb),
    p_rsvp_deadline,
    coalesce(p_is_published, false),
    left(coalesce(p_meal_options, ''), 200),
    left(coalesce(p_getting_there, ''), 2000),
    coalesce(p_theme, 'minimal'),
    coalesce(p_enable_fun_rsvp_options, false),
    left(coalesce(p_smoking_notice, ''), 500),
    left(coalesce(p_parking_notice, ''), 500),
    left(coalesce(p_extra_notice, ''), 500),
    coalesce(p_content_translations, '{}'::jsonb),
    coalesce(p_theme_tokens, '{}'::jsonb),
    coalesce(p_section_photos, '{}'::jsonb),
    coalesce(p_lock_rsvp_after_deadline, false),
    v_tz,
    now()
  )
  on conflict ((true)) do update set
    slug           = coalesce(p_slug, public.weddings.slug),
    love_story     = left(coalesce(p_love_story, ''), 5000),
    dress_code     = left(coalesce(p_dress_code, ''), 200),
    hero_image_url = left(coalesce(p_hero_image_url, ''), 500),
    hero_focal_point = coalesce(p_hero_focal_point, 'center'),
    fun_qa         = coalesce(p_fun_qa, '[]'::jsonb),
    rsvp_deadline  = p_rsvp_deadline,
    is_published   = coalesce(p_is_published, false),
    meal_options   = left(coalesce(p_meal_options, ''), 200),
    getting_there  = left(coalesce(p_getting_there, ''), 2000),
    theme          = coalesce(p_theme, 'minimal'),
    enable_fun_rsvp_options = coalesce(p_enable_fun_rsvp_options, false),
    smoking_notice = left(coalesce(p_smoking_notice, ''), 500),
    parking_notice = left(coalesce(p_parking_notice, ''), 500),
    extra_notice   = left(coalesce(p_extra_notice, ''), 500),
    content_translations = coalesce(p_content_translations, '{}'::jsonb),
    theme_tokens   = coalesce(p_theme_tokens, '{}'::jsonb),
    section_photos = coalesce(p_section_photos, '{}'::jsonb),
    lock_rsvp_after_deadline = coalesce(p_lock_rsvp_after_deadline, false),
    wedding_timezone = v_tz,
    updated_at     = now();
end;
$$;

revoke all on function public.upsert_wedding_page(
  text, text, text, text, jsonb, date, boolean, text, text, text, boolean, text, text, jsonb, jsonb, jsonb, text, text, boolean, text
) from public, anon;
grant execute on function public.upsert_wedding_page(
  text, text, text, text, jsonb, date, boolean, text, text, text, boolean, text, text, jsonb, jsonb, jsonb, text, text, boolean, text
) to authenticated;

-- ── 7. get_wedding_config — surfaces the lock to clients ─────────────────────
-- Reproduced from 0004 §8. Column order in the returns table MUST match the
-- select list exactly, and clients read it positionally, so the three new
-- columns are APPENDED. A return-type change cannot ride on `create or replace`,
-- hence the explicit drop.
--
-- Granted to `anon` (the public RSVP form calls it), so it must expose ONLY
-- public display config. It DELIBERATELY omits the budget/checklist fields:
-- those are internal data served instead by the authenticated, couple-only
-- get_budget_config / get_checklist_config (0006_planning_features.sql). The
-- runsheet column is masked from anon until published (see below).
--
-- rsvp_locked is the COMPUTED verdict, not the raw inputs: the RSVP form renders
-- from it, so the page and the RPC that will accept or refuse the submit can
-- never disagree about whether the form is open. The raw columns come along for
-- the couple's Wedding Page editor to read back.

drop function if exists public.get_wedding_config();

create or replace function public.get_wedding_config()
returns table (
  id                      uuid,
  bride_name              text,
  groom_name              text,
  wedding_date            date,
  venue_name              text,
  venue_address           text,
  ceremony_time           text,
  dinner_time             text,
  tea_ceremony_time       text,
  slug                    text,
  love_story              text,
  dress_code              text,
  hero_image_url          text,
  hero_focal_point        text,
  fun_qa                  jsonb,
  rsvp_deadline           date,
  is_published            boolean,
  meal_options            text,
  getting_there           text,
  theme                   text,
  enable_fun_rsvp_options boolean,
  smoking_notice          text,
  parking_notice          text,
  content_translations    jsonb,
  theme_tokens            jsonb,
  section_photos          jsonb,
  enable_smart_rsvp       boolean,
  primary_meal_event_id   uuid,
  runsheet                jsonb,
  is_runsheet_published   boolean,
  extra_notice            text,
  enable_open_rsvp        boolean,
  enable_photowall        boolean,
  name_order              text,
  lock_rsvp_after_deadline boolean,
  wedding_timezone        text,
  rsvp_locked             boolean
)
language sql
security definer
set search_path = public
as $$
  select
    id,
    bride_name,
    groom_name,
    wedding_date,
    venue_name,
    venue_address,
    to_char(ceremony_time,     'HH24:MI'),
    to_char(dinner_time,       'HH24:MI'),
    to_char(tea_ceremony_time, 'HH24:MI'),
    coalesce(slug, ''),
    coalesce(love_story, ''),
    coalesce(dress_code, ''),
    coalesce(hero_image_url, ''),
    coalesce(hero_focal_point, 'center'),
    coalesce(fun_qa, '[]'::jsonb),
    rsvp_deadline,
    coalesce(is_published, false),
    coalesce(meal_options, ''),
    coalesce(getting_there, ''),
    coalesce(theme, 'minimal'),
    coalesce(enable_fun_rsvp_options, false),
    coalesce(smoking_notice, ''),
    coalesce(parking_notice, ''),
    coalesce(content_translations, '{}'::jsonb),
    coalesce(theme_tokens, '{}'::jsonb),
    coalesce(section_photos, '{}'::jsonb),
    coalesce(enable_smart_rsvp, false),
    primary_meal_event_id,
    -- Draft runsheets are couple-internal coordination data: anon callers get
    -- an empty list until the couple flips the publish toggle. auth.role() is
    -- 'authenticated' for any signed-in account (couple or helper) and
    -- 'anon' / null for the public key alone.
    case
      when coalesce(is_runsheet_published, false)
        or coalesce(auth.role(), '') = 'authenticated'
      then coalesce(runsheet, '[]'::jsonb)
      else '[]'::jsonb
    end,
    coalesce(is_runsheet_published, false),
    coalesce(extra_notice, ''),
    coalesce(enable_open_rsvp, false),
    coalesce(enable_photowall, false),
    coalesce(name_order, 'bride_first'),
    coalesce(lock_rsvp_after_deadline, false),
    coalesce(nullif(trim(wedding_timezone), ''), 'Asia/Singapore'),
    public.is_rsvp_locked()
  from public.weddings
  limit 1;
$$;

-- Stays anon-callable: the PUBLIC RSVP form (RsvpPage.jsx) reads it to render the
-- couple's names/venue/theme and the enable_* flags. It is a read of non-secret
-- display config only (no guest data, and the rsvp/photowall pins are
-- deliberately NOT selected — they are read back only through the couple-only
-- get_open_rsvp_admin_config / get_photowall_admin_config RPCs), so anon read
-- is intentional, not a leak. rsvp_locked/wedding_timezone are display config too.
grant execute on function public.get_wedding_config() to anon, authenticated;
