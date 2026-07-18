-- ── 0014: wishes projection for the D-Day presentation (#149) ─────────────────
-- Wishes Wrapped (and its /wishes-wrapped presentation) is driven by guests'
-- RSVP well-wish messages — columns the helper deliberately cannot read: direct
-- guest selects are couple-only (#99) and get_checkin_guests strips
-- rsvp_message. So helpers get a dedicated read-only projection with EXACTLY
-- the fields the Wrapped charts consume and nothing else: no contact details,
-- notes, tokens, or financial columns. Granted to authenticated only — the
-- messages are shown on a projector at the event, but they are still not for
-- the anonymous public RSVP surface.

drop function if exists public.get_wishes_guests();
create function public.get_wishes_guests()
returns table (
  id                 uuid,
  name               text,
  party              text,
  relationship_group text,
  rsvp_status        text,
  rsvp_message       text
)
language sql
stable
security definer
set search_path = public
as $$
  -- Alias-qualified so columns can never collide with the output names.
  select g.id, g.name, g.party, g.relationship_group, g.rsvp_status, g.rsvp_message
  from public.guests g
  order by g.name asc;
$$;

revoke all on function public.get_wishes_guests() from public, anon;
grant execute on function public.get_wishes_guests() to authenticated;

comment on function public.get_wishes_guests() is
  'Intentionally helper-callable (#149): read-only wishes projection for the D-Day Wishes Wrapped presentation. Exposes name/side/relationship-group/RSVP status/well-wish message only — keep contact details, notes, tokens and financial columns OUT.';
