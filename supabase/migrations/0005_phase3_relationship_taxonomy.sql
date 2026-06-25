-- Phase 3: Guest relationship taxonomy
--
-- Replaces the flat `relationship_group` enum from 0003 with a two-tier
-- model (category + friend subtype). `party` (bride/groom) is unchanged —
-- it drives seating-side segregation, which only makes sense as a binary
-- choice, so no third value is added here.
--
-- Idempotent — safe to re-run. Run this ONCE (or again) in the Supabase SQL
-- Editor after 0001-0004 are applied.

-- ── 1. NEW `friend_subgroup` column (added before the collapse below so we
--    can backfill it from the old relationship_group values first) ──────────

alter table public.guests
  add column if not exists friend_subgroup text not null default ''
    check (friend_subgroup in (
      '', 'army', 'primary_school', 'secondary_school', 'tertiary', 'university', 'other'
    ));

-- ── 2. `relationship_group` — migrate old flat values to the new category set ─
--
-- Old values (0003): '', 'family', 'uni_friends', 'secondary_school',
--   'primary_school', 'colleagues', 'childhood_friends', 'neighbours', 'other'
-- New categories:     '', 'family', 'colleagues', 'friends', 'other'
-- The school/uni distinctions move to `friend_subgroup`.

alter table public.guests drop constraint if exists guests_relationship_group_check;

update public.guests set friend_subgroup = 'university' where relationship_group = 'uni_friends';
update public.guests set friend_subgroup = 'secondary_school' where relationship_group = 'secondary_school';
update public.guests set friend_subgroup = 'primary_school' where relationship_group in ('primary_school', 'childhood_friends');

update public.guests set relationship_group = 'friends'
  where relationship_group in ('uni_friends', 'secondary_school', 'primary_school', 'childhood_friends');

update public.guests set relationship_group = 'other'
  where relationship_group = 'neighbours';

alter table public.guests
  add constraint guests_relationship_group_check
  check (relationship_group in ('', 'family', 'colleagues', 'friends', 'other'));

-- ── 3. `party` — guard against any stray 'both' values from earlier testing,
--    constraint stays bride/groom only ────────────────────────────────────────

update public.guests set party = '' where party not in ('', 'bride', 'groom');

alter table public.guests drop constraint if exists guests_party_check;
alter table public.guests
  add constraint guests_party_check check (party in ('', 'bride', 'groom'));

-- ── 4. RPC updates ─────────────────────────────────────────────────────────────
-- All three RSVP RPCs now read/write `friend_subgroup`. Same security-definer
-- pattern as 0003.

drop function if exists public.get_guest_by_rsvp_token(uuid);

create or replace function public.get_guest_by_rsvp_token(p_token uuid)
returns table (
  id                 uuid,
  name               text,
  rsvp_status        text,
  meal_choice        text,
  plus_one_name      text,
  dietary_notes      text,
  relationship_group text,
  friend_subgroup    text,
  party              text,
  rsvp_message       text
)
language sql
security definer
set search_path = public
as $$
  select
    id, name, rsvp_status, meal_choice,
    plus_one_name, dietary_notes, relationship_group, friend_subgroup, party, rsvp_message
  from public.guests
  where rsvp_token = p_token;
$$;

grant execute on function public.get_guest_by_rsvp_token(uuid) to anon, authenticated;

drop function if exists public.submit_rsvp(uuid, text, text, text, text, text, text);
drop function if exists public.submit_rsvp(uuid, text, text, text, text, text, text, text, text);

create or replace function public.submit_rsvp(
  p_token              uuid,
  p_status             text,
  p_meal_choice        text default '',
  p_plus_one_name      text default '',
  p_dietary_notes      text default '',
  p_relationship_group text default '',
  p_friend_subgroup    text default '',
  p_party              text default '',
  p_message            text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valid_groups  text[] := array['family', 'colleagues', 'friends', 'other', ''];
  v_valid_friends text[] := array['army', 'primary_school', 'secondary_school', 'tertiary', 'university', 'other', ''];
  v_valid_parties text[] := array['bride', 'groom', ''];
begin
  if p_status not in ('confirmed', 'declined') then
    raise exception 'invalid rsvp status: %', p_status;
  end if;

  update public.guests set
    rsvp_status        = p_status,
    rsvp_at             = now(),
    meal_choice         = left(coalesce(p_meal_choice, ''), 60),
    plus_one_name       = left(coalesce(p_plus_one_name, ''), 120),
    dietary_notes       = left(coalesce(p_dietary_notes, ''), 500),
    relationship_group  = case
      when p_relationship_group = any(v_valid_groups) then p_relationship_group
      else relationship_group
    end,
    friend_subgroup     = case
      when p_relationship_group = 'friends' and p_friend_subgroup = any(v_valid_friends)
        then p_friend_subgroup
      when p_relationship_group = any(v_valid_groups) and p_relationship_group != 'friends'
        then ''
      else friend_subgroup
    end,
    party               = case
      when p_party = any(v_valid_parties) and p_party != '' then p_party
      else party
    end,
    rsvp_message        = left(coalesce(p_message, ''), 500)
  where rsvp_token = p_token;

  if not found then
    raise exception 'invalid rsvp token';
  end if;
end;
$$;

grant execute on function public.submit_rsvp(uuid, text, text, text, text, text, text, text, text) to anon, authenticated;

drop function if exists public.submit_rsvp_by_name(text, text, text, text, text);
drop function if exists public.submit_rsvp_by_name(text, text, text, text, text, text, text, text);

create or replace function public.submit_rsvp_by_name(
  p_name               text,
  p_status             text,
  p_meal_choice        text default '',
  p_dietary_notes      text default '',
  p_message            text default '',
  p_relationship_group text default '',
  p_friend_subgroup    text default '',
  p_party              text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids           uuid[];
  v_match_id      uuid;
  v_valid_groups  text[] := array['family', 'colleagues', 'friends', 'other', ''];
  v_valid_friends text[] := array['army', 'primary_school', 'secondary_school', 'tertiary', 'university', 'other', ''];
  v_valid_parties text[] := array['bride', 'groom', ''];
begin
  if p_status not in ('confirmed', 'declined') then
    raise exception 'invalid_status';
  end if;

  select array_agg(id)
  into v_ids
  from public.guests
  where similarity(lower(trim(name)), lower(trim(p_name))) >= 0.4
     or lower(name) like '%' || lower(trim(p_name)) || '%';

  if v_ids is null or array_length(v_ids, 1) = 0 then
    raise exception 'not_found';
  end if;

  if array_length(v_ids, 1) > 1 then
    raise exception 'ambiguous';
  end if;

  v_match_id := v_ids[1];

  update public.guests set
    rsvp_status         = p_status,
    rsvp_at             = now(),
    meal_choice         = left(coalesce(p_meal_choice,   ''), 60),
    dietary_notes       = left(coalesce(p_dietary_notes, ''), 500),
    rsvp_message        = left(coalesce(p_message,       ''), 500),
    relationship_group  = case
      when p_relationship_group = any(v_valid_groups) then p_relationship_group
      else relationship_group
    end,
    friend_subgroup     = case
      when p_relationship_group = 'friends' and p_friend_subgroup = any(v_valid_friends)
        then p_friend_subgroup
      when p_relationship_group = any(v_valid_groups) and p_relationship_group != 'friends'
        then ''
      else friend_subgroup
    end,
    party               = case
      when p_party = any(v_valid_parties) and p_party != '' then p_party
      else party
    end
  where id = v_match_id;
end;
$$;

grant execute on function public.submit_rsvp_by_name(text, text, text, text, text, text, text, text)
  to anon, authenticated;
