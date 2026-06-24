# 💍 Wedding Planner & Guest Tracker

A two-phase wedding management app — pre-wedding RSVP collection and seating plan, then wedding-day check-in, table management, and red packet (angbao) tracking. Built with React + Vite, powered by Supabase.

> The database is the trust boundary: Row Level Security locks all guest data to authenticated helpers. The public RSVP form accesses the DB only through narrow `security definer` RPC functions — the full guest list is never exposed. See [`SECURITY.md`](SECURITY.md) for the threat model.

## Features

### 📋 Planning Mode (pre-wedding)
- **RSVP collection** — guests go to `/rsvp`, fill in their name + choices, submit. Fuzzy name matching verifies them against your guest list without exposing it.
- **RSVP dashboard** — see confirmed / declined / pending counts, headcount (including response rate), meal breakdown; filter by status or bride/groom side; edit any RSVP field inline
- **Seating plan** — create tables with capacity limits, assign confirmed guests, lock tables when done, export as CSV, print-ready layout

### 💒 D-Day Mode (wedding day)
- **Check-in** — tap to mark guests arrived, with timestamp
- **Table view** — all tables at a glance with arrival progress
- **Angbao tracker** — log red packets and amounts per guest, running total
- **VIP & bride/groom tagging** — starred VIPs; colour coding by side
- **CSV import/export** — bulk-import your guest list; export an attendance report
- **JSON backup** — one-tap lossless backup of every guest record
- **Undo** — check-ins, angbao changes, and deletes are undoable from the toast
- **Real-time sync** — devices auto-sync every 5 seconds
- **Search & filter** — by name, table, arrival, or angbao status

Switch between modes with the **📋 Planning / 💒 D-Day** toggle in the header.

---

## How the RSVP works

Share one link with all your guests — no individual links needed:

```
https://your-app.vercel.app/rsvp
```

Guests open it, fill in the form (name, attendance, meal choice, dietary needs, message), and submit. Their name is fuzzy-matched against your guest list on the server — typos and partial names still resolve correctly. If verification passes, their RSVP is saved. The guest list is never sent to the browser.

**Edge cases:**
- Typo in name → still matches if close enough (pg_trgm similarity)
- Multiple people with the same partial name → "please enter your full name"
- Name not found → "check spelling or contact us"
- Partners / plus-ones → add them as separate guests so they RSVP independently (not everyone gets a plus one)

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A free [Supabase](https://supabase.com) account
- A [Vercel](https://vercel.com) account to deploy

---

## 1. Install

```bash
git clone https://github.com/shangweisong/wedding-tracker.git
cd wedding-tracker
npm install
```

## 2. Set up Supabase

### 2a. Database migrations

Open the **SQL Editor** in your Supabase dashboard and run the migrations **in order**:

| File | What it creates |
|---|---|
| [`0001_init.sql`](supabase/migrations/0001_init.sql) | `guests` table, RLS policies, `set_updated_at` trigger |
| [`0002_phase2_rsvp_seating.sql`](supabase/migrations/0002_phase2_rsvp_seating.sql) | `tables` table; RSVP columns on guests (`rsvp_status`, `rsvp_token`, `meal_choice`, etc.); 3 public RPC functions for the RSVP form |
| [`0003_fuzzy_rsvp_by_name.sql`](supabase/migrations/0003_fuzzy_rsvp_by_name.sql) | `pg_trgm` extension; `submit_rsvp_by_name` RPC for fuzzy name-based RSVP submission |

All migrations are idempotent (`CREATE OR REPLACE`, `IF NOT EXISTS`) — safe to re-run.

> ⚠️ Never use `for all using (true)` — that exposes the entire guest list to anyone with the public anon key.

### 2b. Helper login

Under **Authentication → Users**, add one user (e.g. `helpers@wedding.local`) with a strong password. That password is the **access code**.  
Under **Authentication → Providers → Email**, turn off "Allow new users to sign up".

### 2c. API keys

Under **Project Settings → API**, copy your **Project URL** and **anon public key**.

---

## 3. Configure environment

```bash
cp .env.example .env
```

```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your anon key...
VITE_HELPER_EMAIL=helpers@wedding.local   # must match the helper account
VITE_HELPER_PASSWORD=your-access-code     # auto-signs in so the DB works without a PIN screen
```

`.env` is gitignored — never commit it.

---

## 4. Run locally

```bash
npm run dev
```

Open `http://localhost:5173` for the admin. Open `http://localhost:5173/rsvp` to see the guest RSVP form.

To test multi-device sync on the same WiFi, use your computer's LAN IP instead of `localhost`.

---

## 5. Deploy to Vercel

```bash
vercel --prod
```

Or import the repo at [vercel.com](https://vercel.com) for automatic GitHub deploys.

Add all four env vars under **Settings → Environment Variables** before deploying.

Security headers (CSP, HSTS, X-Frame-Options, etc.) are applied automatically via [`vercel.json`](vercel.json).

---

## Adding guests

### Via the app
Admin → D-Day mode → toolbar → **Add Guest** or **Import CSV**.

### CSV format

Columns: `name, table, notes, vip, party` — only `name` is required.

| Column | Description | Example |
|---|---|---|
| `name` | Full name (**required**) | `Tan Wei Ming` |
| `table` | Number or label | `1` or `VIP 1` |
| `notes` | Dietary needs, relationship, etc. | `Vegetarian` |
| `vip` | `true` / `false` | `true` |
| `party` | `bride` or `groom` | `groom` |

```
name,table,notes,vip,party
Tan Wei Ming,1,Best man,true,groom
Ahmad Razif,2,Vegetarian,false,groom
Priya Nair,2,,false,bride
```

> **Partners and plus-ones:** add them as separate rows so they RSVP independently. Only add them if they are actually invited — not everyone needs a plus one.

---

## Workflow

### Before the wedding
1. Import your guest list via CSV (or add guests one by one)
2. Share `https://your-app.vercel.app/rsvp` in your wedding group chat
3. Guests fill in the RSVP form — responses appear in the **RSVP tab** in real time
4. Once RSVPs are in, open the **Seating Plan tab** to assign confirmed guests to tables
5. Export the seating plan as CSV or print it

### On the wedding day
1. Switch to **💒 D-Day** mode in the header
2. Give helpers the URL — they check guests in as they arrive
3. Track angbaos in the **Angbao Tracker tab**
4. Export an attendance report afterwards

---

## Security

No backend of its own — the database is the trust boundary.

- **Admin access** — RLS limits all direct table access to authenticated helpers. The helper account is a shared Supabase Auth user; the password (access code) is verified server-side and never shipped in the bundle.
- **Public RSVP** — the `/rsvp` page has zero direct table access. It calls three `security definer` RPC functions that expose only the minimum needed: fuzzy name verification and writing RSVP fields. The guest list is never returned to the browser.
- **Residual risk** — helpers share one login, so anyone with the access code has full admin access. Fine for a small trusted group. Details in [`SECURITY.md`](SECURITY.md).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| RSVP form says "name not found" | Run `0002` and `0003` migrations in Supabase SQL Editor |
| Not syncing across devices | Use the live Vercel URL, not `localhost`. Check env vars are set in Vercel. |
| Supabase project paused | Free tier pauses after ~1 week idle — restore in the dashboard. Open the app the day before the wedding. |
| "Not saved — check connection" | A write failed (usually flaky WiFi). The optimistic change stays on screen and reconciles on next sync. Use JSON **Backup** as a safety net. |
| Import fails / 400 error | Check browser console. Verify env vars and that CSV columns match the format above. |
