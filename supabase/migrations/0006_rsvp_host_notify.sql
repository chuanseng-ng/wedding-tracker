-- RSVP host notifications — add old_rsvp_status to webhook payload
--
-- The previous trigger body only sent `guest_id`. Adding `old_rsvp_status`
-- lets the API handler distinguish a first-time RSVP (pending → confirmed/declined)
-- from a genuine change of mind (confirmed ↔ declined), so host notification
-- emails only fire for the latter.

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
