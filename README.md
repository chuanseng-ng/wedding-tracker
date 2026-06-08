# 💍 Wedding Guest Attendance Tracker

A real-time, multi-device wedding guest attendance tracker with check-in, table management, and red packet (angbao) tracking. Built with React + Vite, powered by Supabase.

## Why I Built This

I was looking for a simple way to track guest check-ins on the wedding day — who's
arrived, which table they're at — without juggling spreadsheets across multiple
helpers' phones. I also wanted a built-in angbao (red packet) tracker so we could
keep a running tally without a separate notebook.

This codebase is "vibe-coded" with Claude — built through conversation rather than
hand-written from scratch. It works well for my use case, but treat it as a
weekend-project tool rather than production-grade software (see the security caveats
below, especially around the PIN).

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

```sql
create table guests (
  id uuid default gen_random_uuid() primary key,
  name text,
  table_number text,
  checked_in boolean default false,
  checked_in_at timestamptz,
  angbao_given boolean default false,
  angbao_amount numeric default 0,
  notes text,
  is_vip boolean default false,
  party text default ''
);

alter table guests enable row level security;

create policy "public" on guests
  for all using (true) with check (true);
```

You should see **"Success. No rows returned"** at the bottom — this means it worked.

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
```

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

## Step 4 — Configure the App

Near the top of `src/App.jsx`, in the `PIN LOCK` section, you can customise the PIN:

```js
const CORRECT_PIN = "1234"; // ← Change to your desired PIN
```

All helpers will use this PIN to access the app on the wedding day.

> ## ⚠️ READ THIS BEFORE YOU RELY ON THE PIN ⚠️
>
> **The PIN is a soft deterrent, not real security. Use it at your own risk.**
>
> This app is a static frontend with no backend of its own — everything runs in the
> visitor's browser. That means:
>
> - **The PIN is checked entirely client-side.** Anyone who opens browser DevTools
>   (`F12` → Sources, or just "View Page Source" on the deployed bundle) can read the
>   PIN directly out of the JavaScript that gets sent to their browser. There is no way
>   to hide it from a determined visitor — this is true whether the PIN is hardcoded as
>   a string (as it is now) **or** moved into an environment variable
>   (e.g. `VITE_WEDDING_PIN`). Vite bakes `VITE_*` env vars into the public bundle at
>   build time, so the end result is the same either way: the value ships to every
>   browser that loads the page.
> - **Putting the PIN in `.env` does *not* make it secret.** It only keeps it out of
>   your GitHub source code — it has zero effect on what a visitor can see once the
>   site is deployed.
> - **Why does this app even have a PIN, then?** Vercel's built-in **Password
>   Protection** (which *would* gate access at the server/edge level, before any code
>   reaches the browser) is a **paid Pro/Enterprise feature**. This in-app PIN exists
>   purely as a low-effort way to stop casual guests from stumbling onto the guest
>   list — not to stop anyone who actually wants to get in.
> - **If you need real protection** (e.g. the guest list contains sensitive info you
>   don't want exposed under any circumstance), you'll need a server-side gate —
>   Vercel Password Protection, a Supabase Edge Function that checks the PIN before
>   returning data, or similar. That's beyond the scope of this simple tracker.
>
> **Bottom line:** treat this PIN like a "please don't peek" sign on a door, not a
> lock. Don't put anything in the guest list you'd be upset about a stranger seeing.

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

Your app will be live at a URL like `https://wedding-tracker-xxx.vercel.app`. Share this URL and the PIN with your helpers on the wedding day.

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
- **PIN protection** — simple PIN screen to prevent unauthorised access
- **Real-time multi-device sync** — all devices auto-sync every 5 seconds via Supabase
- **Search & filter** — search by name or table; filter by arrived, pending, or angbao given

---

## Supabase Schema Reference

If you ever need to recreate or modify the table, here is the full schema:

```sql
-- Full table creation
create table guests (
  id uuid default gen_random_uuid() primary key,
  name text,
  table_number text,
  checked_in boolean default false,
  checked_in_at timestamptz,
  angbao_given boolean default false,
  angbao_amount numeric default 0,
  notes text,
  is_vip boolean default false,
  party text default ''
);

-- Enable Row Level Security
alter table guests enable row level security;

-- Allow public read/write (protected by app PIN)
create policy "public" on guests
  for all using (true) with check (true);
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
