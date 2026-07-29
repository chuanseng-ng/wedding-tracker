-- 0007_email_automation.sql — RSVP confirmation emails + 90/30-day reminder cron
--
-- Consolidated from: 0005_email_automation (renumbered; content unchanged)
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  OPTIONAL — apply only after completing these steps:                   │
-- │                                                                         │
-- │  1. Deploy your Vercel app and note the URL                             │
-- │  2. Add RESEND_API_KEY + RSVP_WEBHOOK_SECRET to Vercel env vars         │
-- │  3. Run in Supabase SQL Editor (one-time, not in this migration):        │
-- │                                                                         │
-- │     select vault.create_secret(                                         │
-- │       'https://<your-app>.vercel.app/api/send-rsvp-email',              │
-- │       'rsvp_email_webhook_url'                                          │
-- │     );                                                                  │
-- │     select vault.create_secret(                                         │
-- │       '<same-value-as-RSVP_WEBHOOK_SECRET-env-var>',                    │
-- │       'rsvp_email_webhook_secret'                                       │
-- │     );                                                                  │
-- │                                                                         │
-- │  Until both Vault secrets exist the trigger below silently no-ops —    │
-- │  guests can RSVP normally, emails just won't send yet.                  │
-- └─────────────────────────────────────────────────────────────────────────┘

-- ── 1. pg_net EXTENSION ───────────────────────────────────────────────────────
-- Enables outbound HTTP calls from PostgreSQL triggers.

create extension if not exists pg_net;

-- ── 2. RSVP STATUS CHANGE WEBHOOK ────────────────────────────────────────────
--
-- Fires after any UPDATE that moves rsvp_status to 'confirmed' or 'declined'
-- and the guest has an email address. Calls the Vercel serverless function
-- which sends the confirmation email (+ .ics calendar invite if confirmed).
-- Reads URL + secret from Supabase Vault — no-ops if either secret is absent.
--
-- old_rsvp_status is included in the payload so the API handler can
-- distinguish a first-time RSVP (pending → confirmed/declined) from a genuine
-- change of mind (confirmed ↔ declined) and only send host notifications for
-- the latter.
--
-- The `app.suppress_rsvp_email` guard below is LOAD-BEARING — do not remove it.
-- merge_guests (0010_guest_dedupe.sql) is its only setter: an administrative
-- merge can move the canonical guest from pending to confirmed, which would
-- otherwise email that guest a confirmation they never asked for. Because this
-- file is optional and applied out of numeric order (see the box above), the
-- guard has to live HERE, in the single definition of the function — a copy in
-- 0010 would be silently reverted the moment a deployer finally applies 0007.

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
  -- Set transaction-locally by merge_guests (0010_guest_dedupe.sql): an
  -- administrative merge must not look like the guest changing their own RSVP.
  -- current_setting(.., true) returns null rather than raising when the setting
  -- was never set.
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

drop trigger if exists guests_rsvp_status_webhook on public.guests;

create trigger guests_rsvp_status_webhook
  after update on public.guests
  for each row execute function public.notify_rsvp_status_change();

-- ── 3. REMINDER TRACKING COLUMN ──────────────────────────────────────────────
-- Tracks the 30-day reminder independently from last_reminder_sent_at (which
-- covers the 90-day reminder in 0002_rsvp_seating.sql) so both thresholds
-- can fire without interfering with each other.

alter table public.guests
  add column if not exists second_reminder_sent_at timestamptz;
