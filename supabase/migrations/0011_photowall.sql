-- ─────────────────────────────────────────────────────────────────────────────
-- 0011_photowall.sql — guest photowall on the public wedding page (#138)
--
-- Guests upload photos from their phones on /wedding/:slug; the files live in
-- EXTERNAL object storage (Cloudflare R2 or Vercel Blob — see
-- api/_lib/photoStorage/), only the metadata rows live here. Uploads are gated
-- by a couple-chosen PIN (like the open-RSVP pin: a shared low-entropy secret
-- printed on the invitation, verified server-side, never exposed to anon).
--
-- Trust model: anon has NO policies and NO direct write path on
-- photowall_photos. Guest writes go browser → /api/photowall (Vercel fn) →
-- service-role-only RPCs below; anon reads go through get_photowall_photos,
-- which exposes only live rows. The couple moderates via plain RLS
-- (hide/unhide = table update; delete = the API so the storage object dies too).
--
-- Idempotent: guarded column adds; touched functions are dropped and
-- recreated (upsert_wedding_config's signature grows two parameters,
-- get_wedding_config's and get_public_wedding's return types grow a column —
-- none are replaceable in place).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Columns ────────────────────────────────────────────────────────────────
alter table public.weddings
  add column if not exists enable_photowall boolean not null default false;

-- Dedicated pin (NOT rsvp_pin) so the photowall can run while open RSVP is
-- off, and vice versa. Same nature as rsvp_pin: stored plainly, only ever read
-- back through a couple-only RPC.
alter table public.weddings
  add column if not exists photowall_pin text not null default ''
    check (char_length(photowall_pin) <= 20);

-- ── 2. Photo metadata ─────────────────────────────────────────────────────────
-- status: 'pending' = grant issued, upload not yet confirmed (invisible;
-- pruned after a day); 'live' = visible on the public page; 'hidden' =
-- moderated away by the couple (object still exists — delete is the true
-- removal).
create table if not exists public.photowall_photos (
  id            uuid primary key default gen_random_uuid(),
  object_key    text not null unique
                  check (char_length(object_key) between 1 and 400),
  public_url    text not null default ''
                  check (char_length(public_url) <= 1000
                         and (public_url = '' or public_url like 'https://%')),
  uploader_name text not null default ''
                  check (char_length(uploader_name) <= 80),
  caption       text not null default ''
                  check (char_length(caption) <= 280),
  content_type  text not null default ''
                  check (content_type in ('', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes    bigint not null default 0
                  check (size_bytes >= 0 and size_bytes <= 4194304),
  status        text not null default 'pending'
                  check (status in ('pending', 'live', 'hidden')),
  created_at    timestamptz not null default now()
);

alter table public.photowall_photos enable row level security;

-- Couple-only full access (moderation: list all, hide/unhide, delete row).
-- No anon policies at all — anon reads via the RPC, anon writes via the
-- service-role API. This keeps `submissions` the only anon table write in the
-- app (0005 §"anon_insert_submission").
drop policy if exists photowall_couple_all on public.photowall_photos;
create policy photowall_couple_all on public.photowall_photos
  for all to authenticated
  using (not (select public.is_helper()))
  with check (not (select public.is_helper()));

create index if not exists photowall_photos_status_created_idx
  on public.photowall_photos (status, created_at desc);

-- Explicit grant: service_role bypasses RLS but still needs table privileges,
-- and newer Supabase environments no longer give service_role default DML on
-- public tables (same failure mode as checklist_reminder_log in 0006 §grant).
-- api/photowall.js reads rows directly for confirm/delete/prune; without this
-- those calls fail with 42501 and every upload stays stuck at 'pending'.
grant select, delete on public.photowall_photos to service_role;

-- ── 3. Failed-PIN attempt log (brute-force rate limit) ────────────────────────
-- Clone of open_rsvp_pin_attempts (0009 §2): single-tenant global sliding
-- window — 20 wrong PINs in 15 minutes locks uploads for everyone until
-- attempts age out. An attacker can at most lock the wall, not crack the pin.
-- RLS with no policies: only the security-definer RPC (owner) touches it.
create table if not exists public.photowall_pin_attempts (
  id           bigint generated always as identity primary key,
  attempted_at timestamptz not null default now()
);
alter table public.photowall_pin_attempts enable row level security;

-- ── 4. begin_photowall_upload — service-role only, PIN gate + pending row ─────
-- Called by /api/photowall (action "grant") AFTER it has validated the payload
-- shape; this function is the authoritative gate (pin, rate limit, caps) and
-- creates the pending metadata row in the same transaction as the attempt log.
--
-- Returns jsonb — {'id': uuid} on success, {'error': code} for PIN/cap
-- failures. PIN failures are RETURNED rather than RAISED on purpose (0009 §3):
-- an exception would roll back the attempt-log insert and the rate limit would
-- never accumulate. Config/validation errors (disabled / bad type / bad size)
-- still raise — the handler pre-validates those, so a raise means a bug or a
-- bypass attempt.

drop function if exists public.begin_photowall_upload(text, text, text, text, bigint, text);

create function public.begin_photowall_upload(
  p_pin           text,
  p_uploader_name text,
  p_caption       text,
  p_content_type  text,
  p_size_bytes    bigint,
  p_object_key    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_pin     text;
  v_id      uuid;
begin
  select coalesce(w.enable_photowall, false),
         trim(coalesce(w.photowall_pin, ''))
    into v_enabled, v_pin
    from public.weddings w
    limit 1;

  -- The PIN is mandatory; enabled-with-blank-pin (only reachable by editing
  -- the row outside upsert_wedding_config) fails closed.
  if not coalesce(v_enabled, false) or v_pin = '' then
    return jsonb_build_object('error', 'photowall_disabled');
  end if;

  if (select count(*) from public.photowall_pin_attempts
      where attempted_at > now() - interval '15 minutes') >= 20 then
    return jsonb_build_object('error', 'too_many_attempts');
  end if;

  if trim(coalesce(p_pin, '')) <> v_pin then
    delete from public.photowall_pin_attempts
      where attempted_at < now() - interval '1 day';
    insert into public.photowall_pin_attempts default values;
    return jsonb_build_object('error', 'invalid_pin');
  end if;

  if p_content_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'invalid content type';
  end if;
  if coalesce(p_size_bytes, 0) < 1 or p_size_bytes > 4194304 then
    raise exception 'invalid size';
  end if;
  if char_length(trim(coalesce(p_object_key, ''))) < 1 then
    raise exception 'invalid object key';
  end if;

  -- Grant-flood guard: a caller with the correct pin could otherwise mint
  -- unlimited pending rows without ever uploading and exhaust the total cap.
  -- Real uploads confirm within seconds, so a small pending pool is plenty;
  -- stale pendings are pruned by the API after an hour.
  if (select count(*) from public.photowall_photos where status = 'pending') >= 50 then
    return jsonb_build_object('error', 'too_many_attempts');
  end if;

  -- Cheap abuse guard on top of the PIN: cap total rows (any status).
  if (select count(*) from public.photowall_photos) >= 1500 then
    return jsonb_build_object('error', 'photowall_full');
  end if;

  insert into public.photowall_photos
    (object_key, uploader_name, caption, content_type, size_bytes, status)
  values (
    trim(p_object_key),
    left(trim(coalesce(p_uploader_name, '')), 80),
    left(trim(coalesce(p_caption, '')), 280),
    p_content_type,
    p_size_bytes,
    'pending'
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

-- Service-role only: the browser never calls this directly — the API function
-- is the sole caller (it holds the storage credentials the grant needs anyway).
revoke all on function public.begin_photowall_upload(text, text, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.begin_photowall_upload(text, text, text, text, bigint, text)
  to service_role;

-- ── 5. confirm_photowall_photo — service-role only, pending → live ────────────
-- Called by /api/photowall (action "confirm") AFTER it HEAD-verified the
-- object actually exists in storage with an allowed type/size. Stores the
-- server-computed public URL and the verified byte size.

drop function if exists public.confirm_photowall_photo(uuid, text, bigint);

create function public.confirm_photowall_photo(
  p_id         uuid,
  p_public_url text,
  p_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.photowall_photos
     set status     = 'live',
         public_url = left(trim(coalesce(p_public_url, '')), 1000),
         -- Clamp into the check-constraint range so a bad caller value
         -- surfaces as a graceful update, never an unhandled constraint raise.
         size_bytes = least(greatest(coalesce(p_size_bytes, size_bytes), 0), 4194304)
   where id = p_id
     and status = 'pending';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object('error', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.confirm_photowall_photo(uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.confirm_photowall_photo(uuid, text, bigint)
  to service_role;

-- ── 6. get_photowall_photos — anon read of live photos ───────────────────────
-- The public page polls this (~20s). Exposes only live rows and only display
-- fields; gated on the flag so disabling the feature immediately empties the
-- wall. Newest first, hard-capped.

drop function if exists public.get_photowall_photos(text);

create function public.get_photowall_photos(p_slug text)
returns table (
  id            uuid,
  public_url    text,
  uploader_name text,
  caption       text,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.public_url, p.uploader_name, p.caption, p.created_at
    from public.photowall_photos p
   where p.status = 'live'
     and exists (
       select 1 from public.weddings w
        where w.slug = p_slug
          and coalesce(w.enable_photowall, false)
     )
   order by p.created_at desc
   limit 500;
$$;

revoke all on function public.get_photowall_photos(text) from public;
grant execute on function public.get_photowall_photos(text) to anon, authenticated;

-- ── 7. get_public_wedding — expose enable_photowall (append-only column) ──────
-- Body copied from 0003 §5; column order in the returns table MUST match the
-- select list — WeddingPage reads it positionally; new fields are append-only.

drop function if exists public.get_public_wedding(text);

create function public.get_public_wedding(p_slug text)
returns table (
  bride_name        text,
  groom_name        text,
  wedding_date      date,
  venue_name        text,
  venue_address     text,
  ceremony_time     text,
  dinner_time       text,
  tea_ceremony_time text,
  slug              text,
  love_story        text,
  dress_code        text,
  hero_image_url    text,
  hero_focal_point  text,
  fun_qa            jsonb,
  rsvp_deadline     date,
  is_published      boolean,
  meal_options      text,
  getting_there     text,
  theme             text,
  content_translations jsonb,
  theme_tokens      jsonb,
  section_photos    jsonb,
  enable_smart_rsvp boolean,
  enable_photowall  boolean
)
language sql
security definer
set search_path = public
as $$
  select
    bride_name, groom_name, wedding_date, venue_name, venue_address,
    to_char(ceremony_time,     'HH24:MI'),
    to_char(dinner_time,       'HH24:MI'),
    to_char(tea_ceremony_time, 'HH24:MI'),
    slug,
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
    coalesce(content_translations, '{}'::jsonb),
    coalesce(theme_tokens, '{}'::jsonb),
    coalesce(section_photos, '{}'::jsonb),
    coalesce(enable_smart_rsvp, false),
    coalesce(enable_photowall, false)
  from public.weddings
  where slug = p_slug
  limit 1;
$$;

grant execute on function public.get_public_wedding(text) to anon, authenticated;

-- ── 8. get_wedding_config — expose enable_photowall (append-only column) ──────
-- Body copied from 0009 §4; the pin itself is deliberately NOT selected (same
-- treatment as rsvp_pin) — the admin form reads it back through the couple-only
-- RPC in §10.

drop function if exists public.get_wedding_config();

create function public.get_wedding_config()
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
  enable_photowall        boolean
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
    coalesce(enable_photowall, false)
  from public.weddings
  limit 1;
$$;

-- Stays anon-callable: read of non-secret display config only (no guest data,
-- no pins), same rationale as 0009 §4.
grant execute on function public.get_wedding_config() to anon, authenticated;

-- ── 9. upsert_wedding_config — append p_enable_photowall + p_photowall_pin ────
-- Superseded 12-arg signature from 0009_open_rsvp.sql (and, belt-and-braces,
-- the 10-arg 0004 signature in case a partial deploy skipped 0009 — a
-- lingering overload would make PostgREST RPC resolution ambiguous).
drop function if exists public.upsert_wedding_config(
  text, text, date, text, text, text, text, text, boolean, uuid
);
drop function if exists public.upsert_wedding_config(
  text, text, date, text, text, text, text, text, boolean, uuid, boolean, text
);

create function public.upsert_wedding_config(
  p_bride_name        text,
  p_groom_name        text,
  p_wedding_date      date,
  p_venue_name        text,
  p_venue_address     text,
  p_ceremony_time     text,
  p_dinner_time       text,
  p_tea_ceremony_time text default null,
  p_enable_smart_rsvp boolean default false,
  p_primary_meal_event_id uuid default null,
  p_enable_open_rsvp  boolean default false,
  p_rsvp_pin          text default '',
  p_enable_photowall  boolean default false,
  p_photowall_pin     text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Couple-only: security definer bypasses the weddings_write RLS policy, so
  -- the role gate must live inside the function (same pattern as
  -- upsert_budget_config in 0006).
  if (select public.is_helper()) then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  -- The PIN is mandatory whenever open mode is enabled (#126): a blank pin
  -- would leave the form open to anyone who finds the URL.
  if coalesce(p_enable_open_rsvp, false)
     and trim(coalesce(p_rsvp_pin, '')) = '' then
    raise exception 'rsvp pin required';
  end if;

  -- Same invariant for the photowall (#138): uploads must never be open to
  -- anyone who finds the URL.
  if coalesce(p_enable_photowall, false)
     and trim(coalesce(p_photowall_pin, '')) = '' then
    raise exception 'photowall pin required';
  end if;

  insert into public.weddings (
    bride_name, groom_name, wedding_date,
    venue_name, venue_address,
    ceremony_time, dinner_time, tea_ceremony_time,
    enable_smart_rsvp, primary_meal_event_id,
    enable_open_rsvp, rsvp_pin,
    enable_photowall, photowall_pin,
    updated_at
  ) values (
    left(coalesce(p_bride_name, ''), 120),
    left(coalesce(p_groom_name, ''), 120),
    p_wedding_date,
    left(coalesce(p_venue_name, ''), 200),
    left(coalesce(p_venue_address, ''), 500),
    p_ceremony_time::time,
    p_dinner_time::time,
    case when p_tea_ceremony_time = '' then null else p_tea_ceremony_time::time end,
    coalesce(p_enable_smart_rsvp, false),
    p_primary_meal_event_id,
    coalesce(p_enable_open_rsvp, false),
    left(trim(coalesce(p_rsvp_pin, '')), 20),
    coalesce(p_enable_photowall, false),
    left(trim(coalesce(p_photowall_pin, '')), 20),
    now()
  )
  on conflict ((true)) do update set
    bride_name        = excluded.bride_name,
    groom_name        = excluded.groom_name,
    wedding_date      = excluded.wedding_date,
    venue_name        = excluded.venue_name,
    venue_address     = excluded.venue_address,
    ceremony_time     = excluded.ceremony_time,
    dinner_time       = excluded.dinner_time,
    tea_ceremony_time = excluded.tea_ceremony_time,
    enable_smart_rsvp = excluded.enable_smart_rsvp,
    primary_meal_event_id = excluded.primary_meal_event_id,
    enable_open_rsvp  = excluded.enable_open_rsvp,
    rsvp_pin          = excluded.rsvp_pin,
    enable_photowall  = excluded.enable_photowall,
    photowall_pin     = excluded.photowall_pin,
    updated_at        = now();
end;
$$;

revoke all on function public.upsert_wedding_config(
  text, text, date, text, text, text, text, text, boolean, uuid, boolean, text, boolean, text
) from public, anon;
grant execute on function public.upsert_wedding_config(
  text, text, date, text, text, text, text, text, boolean, uuid, boolean, text, boolean, text
) to authenticated;

-- ── 10. get_photowall_admin_config — couple-only pin readback ─────────────────
-- Mirrors get_open_rsvp_admin_config (0009 §6): served separately from
-- get_wedding_config so anon (and the helper) can never see the pin; the
-- couple needs it to pre-fill the Wedding Setup form.

drop function if exists public.get_photowall_admin_config();

create function public.get_photowall_admin_config()
returns table (photowall_pin text)
language sql
security definer
set search_path = public
as $$
  select coalesce(photowall_pin, '')
  from public.weddings
  where not (select public.is_helper())
  limit 1;
$$;

revoke all on function public.get_photowall_admin_config() from public, anon;
grant execute on function public.get_photowall_admin_config() to authenticated;
