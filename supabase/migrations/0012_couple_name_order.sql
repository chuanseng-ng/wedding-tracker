-- ─────────────────────────────────────────────────────────────────────────────
-- 0012_couple_name_order.sql — let the couple choose whose name reads first
--
-- Problem: the two names live in fixed columns (bride_name / groom_name) and were
-- joined ad-hoc at ~20 call sites, always as `${bride_name} & ${groom_name}` —
-- except the public slug (`${groom}-and-${bride}`) and the wedding.inviteTag
-- locale string, which were groom-first. The order was therefore a compile-time
-- constant the couple could not change, and it was not even self-consistent.
--
-- Fix: one `name_order` setting on the singleton weddings row, edited in Wedding
-- Setup and read by every display through src/lib/coupleName.js. Default
-- 'bride_first' so existing deployments render exactly as before.
--
-- Idempotent: add column if not exists + pg_constraint-guarded check; drop-if-
-- exists + create for each function. The three readers use `returns table`, whose
-- return type cannot change under `create or replace`, hence the explicit drops.
-- Per the append-only convention (0003 §5) `name_order` is the LAST column of
-- every reader — the clients read these rows positionally.
-- (Folds into 0003_weddings_page.sql / 0004_smart_rsvp.sql /
-- 0006_planning_features.sql at the next migration-consolidation round.)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. The column ─────────────────────────────────────────────────────────────
alter table public.weddings
  add column if not exists name_order text not null default 'bride_first';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'weddings_name_order_check'
  ) then
    alter table public.weddings
      add constraint weddings_name_order_check
      check (name_order in ('bride_first', 'groom_first'));
  end if;
end $$;

comment on column public.weddings.name_order is
  'Which of bride_name / groom_name reads FIRST wherever the pair is displayed. ''bride_first'' (default, the pre-0012 hardcoded behaviour) or ''groom_first''. Mirrored in JS by src/lib/coupleName.js — do not join the two names by hand.';

-- ── 2. get_wedding_config — admin console + public RSVP form ──────────────────
-- Unchanged except for the appended name_order. Stays anon-callable: the order is
-- public display config, exactly like the names it orders.

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
  name_order              text
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
    coalesce(name_order, 'bride_first')
  from public.weddings
  limit 1;
$$;

grant execute on function public.get_wedding_config() to anon, authenticated;

-- ── 3. get_public_wedding — public page lookup by slug (/wedding/:slug) ───────

drop function if exists public.get_public_wedding(text);

create or replace function public.get_public_wedding(p_slug text)
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
  enable_photowall  boolean,
  name_order        text
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
    coalesce(enable_photowall, false),
    coalesce(name_order, 'bride_first')
  from public.weddings
  where slug = p_slug
  limit 1;
$$;

grant execute on function public.get_public_wedding(text) to anon, authenticated;

-- ── 4. get_public_runsheet — public /runsheet/:slug page ──────────────────────
-- The runsheet header prints the couple names, so it needs the order too.

drop function if exists public.get_public_runsheet(text);

create or replace function public.get_public_runsheet(p_slug text)
returns table (
  bride_name            text,
  groom_name            text,
  wedding_date          date,
  venue_name            text,
  runsheet              jsonb,
  is_runsheet_published boolean,
  name_order            text
)
language sql
security definer
set search_path = public
as $$
  select
    bride_name,
    groom_name,
    wedding_date,
    coalesce(venue_name, ''),
    coalesce(runsheet, '[]'::jsonb),
    coalesce(is_runsheet_published, false),
    coalesce(name_order, 'bride_first')
  from public.weddings
  where slug = p_slug
    and coalesce(is_runsheet_published, false) = true
  limit 1;
$$;

grant execute on function public.get_public_runsheet(text) to anon, authenticated;

comment on function public.get_public_runsheet(text) is
  'Intentionally anon-callable: read-only, published-runsheets-only surface for the public /runsheet/:slug page. Do not add an is_helper() gate.';

-- ── 5. upsert_wedding_config — admin write (Wedding Setup), couple-only ───────
-- Appends p_name_order. Superseded signatures are dropped so PostgREST RPC
-- resolution stays unambiguous.

drop function if exists public.upsert_wedding_config(
  text, text, date, text, text, text, text, text, boolean, uuid, boolean, text, boolean, text
);

create or replace function public.upsert_wedding_config(
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
  p_photowall_pin     text default '',
  p_name_order        text default 'bride_first'
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
    name_order,
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
    -- Clamp rather than trust: an unknown value degrades to the historical
    -- bride-first rendering instead of tripping weddings_name_order_check.
    case when p_name_order = 'groom_first' then 'groom_first' else 'bride_first' end,
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
    name_order        = excluded.name_order,
    updated_at        = now();
end;
$$;

revoke all on function public.upsert_wedding_config(
  text, text, date, text, text, text, text, text, boolean, uuid, boolean, text, boolean, text, text
) from public, anon;
grant execute on function public.upsert_wedding_config(
  text, text, date, text, text, text, text, text, boolean, uuid, boolean, text, boolean, text, text
) to authenticated;
