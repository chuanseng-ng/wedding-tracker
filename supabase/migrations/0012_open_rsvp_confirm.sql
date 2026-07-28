-- ─────────────────────────────────────────────────────────────────────────────
-- 0012_open_rsvp_confirm.sql — catch open-RSVP near-duplicates at the door
--
-- 0008 matches a typed name against the guest list by EXACT case-insensitive
-- equality, so someone already invited as "Wei Ming Tan" who types
-- "Wei-Ming Tan" silently becomes a second guest row. 0011 added the couple's
-- cleanup tooling; this closes the loop at the source by asking the guest once:
--
--   "Did you mean Wei Ming Tan?"  [Yes, that's me]  [No — continue as typed]
--
-- SECURITY — this is a deliberate, bounded widening of what open RSVP reveals.
-- Confirming a candidate hands back that guest's rsvp_token, and the candidate
-- list itself names real guests. Today you must guess a name EXACTLY to get
-- either. Four controls bound the new surface, and all four are load-bearing:
--
--   1. Matching runs only AFTER the PIN check. A wrong PIN returns before any
--      guest row is touched, and still burns a rate-limit attempt.
--   2. The 0.55 similarity threshold (shared with 0011) means short probes do
--      not match — similarity('tan', 'tan wei ming') is ~0.31, so fishing with
--      a surname surfaces nobody.
--   3. At most 3 candidates per submission, and only id + name are returned —
--      never contact details, RSVP status or seating.
--   4. The existing sliding-window lockout (20 wrong PINs / 15 min, 0008) is
--      untouched and still gates every call.
--
-- A confirmed id is RE-VALIDATED server-side against the typed name: the client
-- cannot confirm an arbitrary guest id it did not receive as a candidate.
--
-- Idempotent: the function is dropped and recreated. Requires 0011 for
-- public.normalize_guest_name.
-- ─────────────────────────────────────────────────────────────────────────────

-- The 2-arg signature from 0008 is replaced. New parameters are append-only and
-- defaulted, so an un-updated client calling with just (p_name, p_pin) still
-- resolves — it simply never sends a confirmation and behaves as before, except
-- that a near-match now returns needs_confirm instead of silently inserting.
drop function if exists public.register_open_rsvp(text, text);
drop function if exists public.register_open_rsvp(text, text, uuid, boolean);

create function public.register_open_rsvp(
  p_name             text,
  p_pin              text    default '',
  p_confirm_guest_id uuid    default null,
  p_force_new        boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled    boolean;
  v_smart      boolean;
  v_pin        text;
  v_name       text;
  v_norm       text;
  v_id         uuid;
  v_token      uuid;
  v_candidates jsonb;
begin
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

  -- ── Everything below this line runs only with a verified PIN. ──────────────

  v_name := left(trim(coalesce(p_name, '')), 120);
  if char_length(v_name) < 1 then
    raise exception 'invalid name';
  end if;
  v_norm := public.normalize_guest_name(v_name);

  -- Tier 1: exact match — unchanged from 0008. Reuse the row silently; asking
  -- "did you mean X?" when the guest typed exactly X would be nonsense, and
  -- reuse is what stops re-submissions duplicating a pre-invited guest.
  select g.id, g.rsvp_token
    into v_id, v_token
    from public.guests g
   where g.primary_guest_id is null
     and lower(trim(g.name)) = lower(v_name)
   order by g.created_at
   limit 1;

  -- Tier 2: the guest confirmed one of the candidates we offered. Re-validate
  -- server-side — the client must not be able to claim an arbitrary guest id.
  -- The id has to still be a primary AND still be a near-match of the name
  -- typed in THIS submission.
  if v_id is null and p_confirm_guest_id is not null then
    select g.id, g.rsvp_token
      into v_id, v_token
      from public.guests g
     where g.id = p_confirm_guest_id
       and g.primary_guest_id is null
       and public.normalize_guest_name(g.name) <> ''
       and (
             public.normalize_guest_name(g.name) = v_norm
          or similarity(public.normalize_guest_name(g.name), v_norm) >= 0.55
           );

    -- A confirmation that no longer holds (guest merged away, renamed, or a
    -- forged id) is refused rather than silently falling through to an insert,
    -- which would create the duplicate this whole feature exists to prevent.
    if v_id is null then
      return jsonb_build_object('error', 'confirm_failed');
    end if;
  end if;

  -- Tier 3: no exact match and nothing confirmed — look for near-matches worth
  -- asking about, unless the guest already told us to go ahead as typed.
  --
  -- The >= 2 character floor matches find_guest_by_name (0002) and keeps a
  -- one-character probe from being answered at all.
  if v_id is null and not coalesce(p_force_new, false) and char_length(v_norm) >= 2 then
    -- The ORDER BY inside the subquery is what LIMIT 3 applies to (best three);
    -- the ORDER BY on jsonb_agg is what fixes their order in the output. Both
    -- are needed — a bare LIMIT would take an arbitrary three.
    -- Only id and name are ever projected.
    select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.sim desc, s.name asc)
      into v_candidates
      from (
        select g.id, g.name,
               similarity(public.normalize_guest_name(g.name), v_norm) as sim
          from public.guests g
         where g.primary_guest_id is null
           and public.normalize_guest_name(g.name) <> ''
           and (
                 public.normalize_guest_name(g.name) = v_norm
              or similarity(public.normalize_guest_name(g.name), v_norm) >= 0.55
               )
         order by sim desc, g.name asc
         limit 3
      ) s;

    if v_candidates is not null then
      -- Note: nothing has been written. The guest re-submits with either
      -- p_confirm_guest_id or p_force_new to actually register.
      return jsonb_build_object('needs_confirm', true, 'candidates', v_candidates);
    end if;
  end if;

  -- Tier 4: genuinely new (or the guest chose to continue as typed).
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

comment on function public.register_open_rsvp(text, text, uuid, boolean) is
  'Anon-callable open-RSVP registration. Returns {token}, {needs_confirm, candidates[]} when the typed name looks like an existing guest, or {error} for PIN failures. All name matching happens AFTER the PIN check and inside the existing rate limit; a confirmed id is re-validated against the typed name server-side. See the header of 0012 for the four controls bounding the disclosure.';

revoke all on function public.register_open_rsvp(text, text, uuid, boolean) from public;
grant execute on function public.register_open_rsvp(text, text, uuid, boolean) to anon, authenticated;
