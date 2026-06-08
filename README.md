# 💍 Wedding Guest Attendance Tracker

A real-time, multi-device wedding guest attendance tracker with check-in, table management, and red packet (angbao) tracking. Built with React + Vite, powered by Supabase.

## Why I Built This

I was looking for a simple way to track guest check-ins on the wedding day — who's
arrived, which table they're at — without juggling spreadsheets across multiple
helpers' phones. I also wanted a built-in angbao (red packet) tracker so we could
keep a running tally without a separate notebook.

This codebase is "vibe-coded" with Claude — built through conversation rather than
hand-written from scratch. It works well for my use case, but treat it as a
weekend-project tool rather than production-grade software. Access is gated by a
server-verified helper sign-in and the database is locked down with Row Level
Security — see [`SECURITY.md`](SECURITY.md) for the threat model and residual risks.

---

## Prerequisites

Before you begin, make sure you have the following installed:

- [Node.js](https://nodejs.org/) (v18 or above)
- [VS Code](https://code.visualstudio.com/) or any code editor
- A free [Supabase](https://supabase.com) account
- A free [Vercel](https://vercel.com) account

---

## Step 1 — Clone & Install the Project

Open your terminal and run:

```bash
npm create vite@latest wedding-tracker -- --template react
cd wedding-tracker
npm install
```

Then replace `src/App.jsx` with the provided `wedding-tracker.jsx` file and rename it to `App.jsx`.

Clear the contents of `src/index.css` (the app has its own styles built in).

---

## Step 2 — Set Up Supabase

### 2.1 Create a Project

1. Go to [supabase.com](https://supabase.com) and sign up for a free account
2. Click **New Project**
3. Give it a name (e.g. `wedding-tracker`), set a database password, and choose a region close to you
4. Wait 1–2 minutes for the project to spin up — you'll know it's ready when the full dashboard sidebar appears

### 2.2 Create the Guests Table

1. In the left sidebar, click **SQL Editor**
2. Click **New Query**
3. Paste the following and click **Run** (or press `Ctrl+Enter` / `Cmd+Enter`):

Paste the contents of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)
(in this repo). It creates the `guests` table with integrity constraints and —
importantly — **locks Row Level Security to signed-in helpers only**:

```sql
alter table public.guests enable row level security;

-- Authenticated helpers get full access; the anonymous role has NO policy,
-- so the public anon key alone cannot read or modify any data.
create policy "helpers_select" on public.guests for select to authenticated using (true);
create policy "helpers_insert" on public.guests for insert to authenticated with check (true);
create policy "helpers_update" on public.guests for update to authenticated using (true) with check (true);
create policy "helpers_delete" on public.guests for delete to authenticated using (true);
```

> ⚠️ **Do not use a `for all using (true) with check (true)` policy.** That makes
> the entire guest list publicly readable, writable, and deletable by anyone who
> has the anon key (which ships in the browser bundle). The migration above is the
> secure replacement.

You should see **"Success. No rows returned"** at the bottom — this means it worked.

### 2.2a Create the Helper Login

The app is unlocked by signing in to a single shared account (verified by
Supabase Auth on the server — see Step 4).

1. In the left sidebar, go to **Authentication → Users → Add user**.
2. Create one user, e.g. email `helpers@wedding.local` with a strong password —
   this password is the **access code** you'll share with your helpers.
3. Go to **Authentication → Providers → Email** and **turn off "Allow new users
   to sign up"** so strangers can't self-register an account.

### 2.3 Get Your API Keys

1. In the left sidebar, click **Project Settings** (gear icon at the bottom)
2. Click **API**
3. Copy the following — you'll need them in the next step:
   - **Project URL** — looks like `https://xxxxxxxxxxxx.supabase.co`
   - **anon public key** — a long string starting with `eyJ...`

---

## Step 3 — Configure Environment Variables

### 3.1 Local Development

Copy the example env file and fill in your own values:

```bash
cp .env.example .env
```

Then open `.env` and replace the placeholders with your actual Supabase **Project URL**
and **anon public key** from step 2.3:

```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your anon key here...
VITE_HELPER_EMAIL=helpers@wedding.local
```

`VITE_HELPER_EMAIL` must match the email of the helper account you created in
step 2.2a. It is **not** a secret — only the account's password (the access code
your helpers type in) is.

Then open `src/App.jsx` and make sure the top two lines read:

```js
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
```

### 3.2 Add `.env` to `.gitignore`

Make sure your `.env` file is never committed to GitHub. Open `.gitignore` and confirm this line exists:

```
.env
```

---

## Step 4 — How Access Control Works

The app is unlocked by signing in to the shared helper account you created in
step 2.2a. On the unlock screen, helpers type the account **password** (the
"access code"); the app calls Supabase Auth's `signInWithPassword` and the
credential is verified **on the server**. Nothing to configure in `src/App.jsx` —
just set `VITE_HELPER_EMAIL` to match the account.

Share the access code (the password) with your helpers however you'd normally
share a private password.

> ### ✅ This is real, server-side access control
>
> Earlier versions of this app used a 4-digit PIN compared in the browser. That
> was a "soft deterrent" only — anyone could read the PIN out of the JavaScript
> bundle via DevTools, and (because of the open database policy) read or delete
> the entire guest list directly through the Supabase API without even loading
> the app.
>
> The current design fixes both problems:
>
> - **The access code is never in the bundle and never checked client-side.** It
>   is the password of a Supabase Auth user, verified on the server. Only the
>   non-secret helper *email* ships to the browser.
> - **The database is locked to authenticated helpers.** Row Level Security grants
>   access only to the `authenticated` role (see the migration in step 2.2), so an
>   unauthenticated request with the public anon key is denied — it cannot read,
>   insert, update, or delete anything.
>
> **Residual risk:** all helpers share one login, so anyone who learns the access
> code has full access to the guest list. That suits a small group of trusted
> helpers; for stronger isolation, create per-helper accounts. See
> [`SECURITY.md`](SECURITY.md).

---

## Step 5 — Run Locally

```bash
npm run dev
```

Open your browser to **http://localhost:5173**. The app will load with your Supabase data.

To test multi-device sync on the same WiFi, open the app on another device using your computer's local IP address instead of `localhost`, e.g. `http://192.168.1.x:5173`.

---

## Step 6 — Deploy to Vercel

### 6.1 Create a Vercel Account

Go to [vercel.com](https://vercel.com) and sign up for free (use **Continue with GitHub** for the easiest setup).

### 6.2 Add Environment Variables on Vercel

1. Go to your Vercel dashboard → your project → **Settings → Environment Variables**
2. Add the following two variables:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | your Supabase anon key |
| `VITE_HELPER_EMAIL` | email of the helper account (from step 2.2a) |

### 6.3 Deploy

In your project terminal, run:

```bash
npm install -g vercel
vercel
```

Follow the prompts to link your account. For subsequent deployments after code changes, run:

```bash
vercel --prod
```

Your app will be live at a URL like `https://wedding-tracker-xxx.vercel.app`. Share this URL and the access code (the helper account password) with your helpers on the wedding day.

The included [`vercel.json`](vercel.json) adds security response headers (CSP,
HSTS, `X-Frame-Options`, etc.) automatically on deploy.

---

## CSV Schema

Prepare your guest list as a `.csv` file with the following columns:

```
name,table,notes,vip,party
```

| Column | Required | Description | Example |
|---|---|---|---|
| `name` | ✅ Yes | Full name of the guest | `Tan Wei Ming` |
| `table` | No | Table name or number | `1` or `VIP 1` |
| `notes` | No | Dietary needs, relationship, etc. | `Vegetarian` |
| `vip` | No | Mark as VIP guest | `true` or `false` |
| `party` | No | Bride or groom's side — used for colour coding in Table view | `bride` or `groom` |

**Notes:**
- The only required column is `name` — all others are optional
- If `party` column is absent, tables will display in the default white colour with no badge
- `table` accepts both numbers (`1`) and text (`VIP 1`, `Groom 2`)
- `vip` accepts `true` or `false`; leave blank or omit if not applicable

**Example CSV:**

```
name,table,notes,vip,party
Tan Wei Ming,1,Best man,true,groom
Lim Siew Yong,2,,false,bride
Ahmad Razif,VIP 1,Vegetarian,false,groom
Priya Nair,VIP 2,,true,bride
David Koh,3,Boss,,groom
```

To import: click **Import CSV** in the app toolbar, upload your file, and click **Import Guests**.

---

## Features

- **Guest check-in** — tap to mark guests as arrived with timestamp
- **Table view** — see all tables at a glance with arrival progress bar; tap any guest to update check-in or angbao status inline
- **Bride/Groom colour coding** — pink for bride's side, blue for groom's side (requires `party` column in CSV)
- **Angbao tracker** — log red packet given and amount per guest, with running total
- **VIP guests** — starred and highlighted
- **CSV import/export** — bulk import guest list; export final attendance report after the event
- **Helper sign-in** — server-verified access code (Supabase Auth) gates the app; the database is locked to authenticated helpers via RLS
- **Real-time multi-device sync** — all devices auto-sync every 5 seconds via Supabase
- **Search & filter** — search by name or table; filter by arrived, pending, or angbao given

---

## Supabase Schema Reference

The authoritative, version-controlled schema + RLS policies live in
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql). Run that
file to (re)create everything. Its shape:

```sql
create table public.guests (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 120),
  table_number  text not null default '1' check (char_length(table_number) <= 20),
  checked_in    boolean not null default false,
  checked_in_at timestamptz,
  angbao_given  boolean not null default false,
  angbao_amount numeric not null default 0 check (angbao_amount >= 0),
  notes         text default '' check (char_length(coalesce(notes,'')) <= 500),
  is_vip        boolean not null default false,
  party         text not null default '' check (party in ('', 'bride', 'groom')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- RLS: authenticated helpers only (anon has no policy → denied by default).
alter table public.guests enable row level security;
create policy "helpers_select" on public.guests for select to authenticated using (true);
create policy "helpers_insert" on public.guests for insert to authenticated with check (true);
create policy "helpers_update" on public.guests for update to authenticated using (true) with check (true);
create policy "helpers_delete" on public.guests for delete to authenticated using (true);
```

To verify your columns at any time, run:

```sql
select column_name, data_type
from information_schema.columns
where table_name = 'guests';
```

To clear all guests before a fresh import:

```sql
delete from guests;
```

---

## Troubleshooting

**Import not working / 400 error**
- Open browser console (`Cmd+Option+J` on Mac, `F12` on Windows) and check the error message
- Verify your Supabase URL and anon key are correctly set in `.env`
- Make sure all columns in your CSV match the schema above

**App not syncing across devices**
- Confirm both devices are using the live Vercel URL, not `localhost`
- Check that environment variables are set in Vercel dashboard under Settings → Environment Variables

**Project paused on Supabase**
- Supabase free tier pauses projects after 1 week of inactivity
- Log in to Supabase dashboard and click **Restore project** — takes about 1 minute
- Tip: open the app a day before the wedding to make sure it's active
