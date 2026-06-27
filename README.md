# 💍 Wedding Planner & Guest Tracker

A two-phase wedding management app — pre-wedding RSVP collection and seating plan, then wedding-day check-in, table management, and red packet (angbao) tracking. Built with React + Vite, powered by Supabase.

> The database is the trust boundary: Row Level Security locks all guest data to authenticated helpers. The public RSVP form accesses the DB only through narrow `security definer` RPC functions — the full guest list is never exposed. See [`SECURITY.md`](SECURITY.md) for the threat model.

## Features

### 📋 Planning Mode (pre-wedding)
- **RSVP collection** — guests go to `/rsvp`, fill in their name + choices, submit. Fuzzy name matching verifies them against your guest list without exposing it.
- **RSVP dashboard** — see confirmed / declined / pending counts, headcount (including response rate), meal breakdown; filter by status or bride/groom side; edit any RSVP field inline
- **Seating plan** — create tables with capacity limits, assign confirmed guests by dropdown or drag-and-drop, lock tables when done, export as CSV, print-ready layout
- **Draft seating suggestion** — one click groups unassigned confirmed guests by side / relationship / friend group and packs them into open tables as a starting draft to rearrange by hand — no AI involved, just deterministic clustering

### 💒 D-Day Mode (wedding day)
- **Check-in** — tap to mark guests arrived, with timestamp
- **Table view** — all tables at a glance with arrival progress; tap a guest to update inline
- **Angbao tracker** — log red packets and amounts per guest, with a running total. Optional: turn the whole feature off with `VITE_ENABLE_ANGBAO=false` for events that don't collect ang-bao (see [Disabling angbao tracking](#disabling-angbao-tracking))
- **PayNow ang-bao QR** — a public, login-free page where guests type an amount and scan a pre-filled, amount-locked PayNow QR to send a gift (Singapore only)
- **VIP & bride/groom tagging** — starred VIPs; pink/blue colour coding by side
- **CSV import/export** — bulk import a guest list; export an attendance report afterwards
- **JSON backup** — one-tap lossless backup of every guest record (the safety net)
- **Undo** — check-ins, angbao changes, and deletes can be undone from the toast
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
| [`0002_draw_and_submissions.sql`](supabase/migrations/0002_draw_and_submissions.sql) | Lucky-draw number, guest receipt-upload queue (`submissions` table), private `receipts` storage bucket |
| [`0003_rsvp_seating.sql`](supabase/migrations/0003_rsvp_seating.sql) | `tables` table; all RSVP columns on guests (`rsvp_status`, `meal_choice`, `email`, etc.); fuzzy name-match RPC (`submit_rsvp_by_name`); relationship taxonomy columns |
| [`0004_weddings.sql`](supabase/migrations/0004_weddings.sql) | Singleton `weddings` table; wedding page columns (slug, love story, hero photo, etc.); `get_wedding_config` / `upsert_wedding_config` / `get_public_wedding` RPCs; photo storage bucket |
| [`0005_email_automation.sql`](supabase/migrations/0005_email_automation.sql) | `pg_net` extension; RSVP status-change webhook trigger; `last_reminder_sent_at` column — **apply only after completing the email setup in step 6** |

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
VITE_HELPER_EMAIL=helpers@wedding.local   # must match the helper account; not secret

# Optional — auto-signs in so the DB works without the PIN screen
VITE_HELPER_PASSWORD=your-access-code

# Optional — enables the PayNow ang-bao page (Singapore). Not secret.
VITE_PAYNOW_MOBILE=+6591234567            # the couple's PayNow-linked mobile
VITE_PAYNOW_NAME=The Happy Couple         # name shown to guests

# Optional — set to "false" to hide all ang-bao tracking (stat pill, Angbao
# Tracker tab, per-guest toggles, Submissions tab, public gift page). Default on.
# Only hides the UI; existing angbao data is preserved if re-enabled.
VITE_ENABLE_ANGBAO=true
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

1. Import the repo at [vercel.com](https://vercel.com) (or run `npx vercel`) for automatic GitHub deploys.
2. Add the env vars from step 3 under **Settings → Environment Variables** (include the optional `VITE_PAYNOW_*` pair to enable the ang-bao QR, or set `VITE_ENABLE_ANGBAO=false` to turn ang-bao tracking off entirely).
3. Deploy. Security headers (CSP, HSTS, X-Frame-Options, etc.) are applied automatically via [`vercel.json`](vercel.json).

---

## 6. Email automation (optional)

When a guest submits the RSVP form, they receive a confirmation email with a `.ics` calendar invite attached. Guests who haven't responded receive reminder emails 90 days and 30 days before the wedding.

This is powered by a Supabase webhook trigger → Vercel serverless function. Two email providers are supported.

---

### Choose a provider

Set `EMAIL_PROVIDER` in your Vercel environment variables:

| Provider | `EMAIL_PROVIDER` | Requires | Best for |
|---|---|---|---|
| **Gmail** (default) | `gmail` | A Gmail App Password | Anyone — no domain needed |
| **Resend** | `resend` | A verified sending domain | Custom `rsvp@yourdomain.com` address |

---

### Option A — Gmail (recommended, no domain needed)

Gmail sends from your existing Google account. No domain purchase, no service approval, no IP restrictions. Limit is 500 emails/day — well above any wedding guest list.

**Step 1 — Enable 2-Step Verification on your Google account**

Go to [myaccount.google.com/security](https://myaccount.google.com/security) and turn on 2-Step Verification if it isn't already on. (App Passwords require this.)

**Step 2 — Create an App Password**

1. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. Under "App name", type `wedding tracker`
3. Click **Create** — Google generates a 16-character password
4. Copy it (you won't see it again)

**Step 3 — Add env vars to your `.env`**

```
EMAIL_PROVIDER=gmail
GMAIL_FROM=yourname@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
```

---

### Option B — Resend (custom sending domain)

Resend sends from `rsvp@yourdomain.com`. Better deliverability and a more professional appearance. Requires a domain you control so you can add DNS records.

**Step 1 — Buy a domain**

Any registrar works — [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) (~$8–12/yr) is recommended (no markup on wholesale prices).

**Step 2 — Verify the domain in Resend**

1. Sign up at [resend.com](https://resend.com) and go to **Domains → Add Domain**
2. Enter your domain (e.g. `mail.yourdomain.com`)
3. Resend gives you two DNS records to add — an SPF `TXT` record and a DKIM `TXT` record
4. Add them in your domain registrar's DNS settings
5. Click **Verify** in Resend — usually takes a few minutes

**Step 3 — Create an API key**

Go to **Resend → API Keys → Create API key**. Copy it.

**Step 4 — Add env vars to your `.env`**

```
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_SENDING_DOMAIN=mail.yourdomain.com
```

---

### Push env vars to Vercel

Instead of adding variables one-by-one in the Vercel dashboard, use the included setup script. It reads your `.env`, detects which provider you've chosen, and pushes the right set of variables to Vercel (production + preview + development) in one command.

**Preview what will be pushed (no changes made):**
```bash
bash scripts/setup-vercel-env.sh --dry-run
```

**Push to Vercel:**
```bash
bash scripts/setup-vercel-env.sh
```

Then redeploy:
```bash
vercel --prod
```

---

### Wire up the Supabase webhook

This is a one-time step in the **Supabase SQL Editor**. It tells Supabase where to call when a guest RSVPs.

**Step 1 — Apply the email automation migration** (if you haven't already):

Run [`0005_email_automation.sql`](supabase/migrations/0005_email_automation.sql) in the SQL Editor.

**Step 2 — Register the webhook URL and secret in Supabase Vault:**

```sql
select vault.create_secret(
  'https://<your-app>.vercel.app/api/send-rsvp-email',
  'rsvp_email_webhook_url'
);

select vault.create_secret(
  '<same value as RSVP_WEBHOOK_SECRET in your .env>',
  'rsvp_email_webhook_secret'
);
```

Replace `<your-app>` with your Vercel project URL (e.g. `wedding-tracker-eight.vercel.app`).

The trigger silently no-ops until both secrets exist — guests can RSVP normally, emails just won't send yet.

---

### Adding guests

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
1. Fill in your wedding details in the **Wedding Setup tab** (couple names, date, venue, ceremony/dinner time) — do this first, since the RSVP confirmation email and calendar invite read from it
2. Import your guest list via CSV (or add guests one by one)
3. Share `https://your-app.vercel.app/rsvp` in your wedding group chat
4. Guests fill in the RSVP form — responses appear in the **RSVP tab** in real time
5. Once RSVPs are in, open the **Seating Plan tab** to assign confirmed guests to tables
6. Export the seating plan as CSV or print it

### On the wedding day
1. Switch to **💒 D-Day** mode in the header
2. Give helpers the URL — they check guests in as they arrive
3. Track angbaos in the **Angbao Tracker tab**
4. Export an attendance report afterwards

---

## PayNow ang-bao QR (Singapore)

Guests can send a cash gift without any hassle: they open the public **#pay** page
(linked as *“Send a gift · Ang-Bao →”* on the sign-in screen — no access code needed),
type an amount, and get a PayNow QR pre-filled with that amount and **locked** so it
can’t be changed. Scanning it with any Singapore banking app fills in the payment
ready to confirm. Share `https://your-site.vercel.app/#pay` directly with guests if you
like.

- Set `VITE_PAYNOW_MOBILE` to the couple's PayNow-linked mobile and `VITE_PAYNOW_NAME`
  to the name guests should see. Without `VITE_PAYNOW_MOBILE`, the page shows a “not set
  up yet” notice.
- The QR is generated entirely in the browser (EMVCo/SGQR standard) — no backend, no
  payment provider, no fees. The mobile number is embedded in the QR and visible to
  anyone who decodes it (inherent to PayNow QR).
- **No automatic confirmation.** Singapore banks don’t expose a payment webhook for
  personal accounts, so the app can’t detect that a gift arrived — marking ang-bao as
  received in the helper tracker stays manual. **Test with a real banking app (e.g. a
  S$0.01 transfer) before the wedding.**

## Disabling angbao tracking

Not every event collects ang-bao. Set `VITE_ENABLE_ANGBAO=false` (in `.env` for
local dev, or under **Settings → Environment Variables** in Vercel) to hide the
entire ang-bao feature, then rebuild/redeploy. When disabled, the app no longer
shows:

- the **🧧 Angbaos** stat pill in the header
- the **Angbao Tracker** tab and the **Submissions** tab
- the **🧧 Gave** search filter
- the per-guest ang-bao toggle and amount field (on guest cards, in the table
  view, and in the quick-edit popup)
- the public **#pay** PayNow gift page and its *“Send a gift · Ang-Bao →”* link

The toggle is **build-time** and read once at startup, so changing it requires a
rebuild/redeploy — it can't be flipped from inside the running app. It is also
**UI-only and non-destructive**: the `angbao_given` / `angbao_amount` columns and
any values already recorded are left untouched in the database, so re-enabling the
feature later brings every amount back exactly as it was. Leave the variable unset
(or `true`) to keep ang-bao tracking on, which is the default.

## Security

No backend of its own — the database is the trust boundary.

- **Admin access** — RLS limits all direct table access to authenticated helpers. The helper account is a shared Supabase Auth user; the password (access code) is verified server-side and never shipped in the bundle.
- **Public RSVP** — the `/rsvp` page has zero direct table access. It calls three `security definer` RPC functions that expose only the minimum needed: fuzzy name verification and writing RSVP fields. The guest list is never returned to the browser.
- **Residual risk** — helpers share one login, so anyone with the access code has full admin access. Fine for a small trusted group. Details in [`SECURITY.md`](SECURITY.md).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| RSVP form says "name not found" | Run the `0003` and `0004` migrations in the Supabase SQL Editor |
| Not syncing across devices | Use the live Vercel URL, not `localhost`. Check env vars are set in Vercel. Devices poll every 5 seconds; the **Refresh** button forces an immediate sync. |
| Supabase project paused | Free tier pauses after ~1 week idle — restore in the dashboard. Open the app the day before the wedding. |
| "Not saved — check connection" | A write failed (usually flaky WiFi). The optimistic change stays on screen and reconciles on next sync. Use JSON **Backup** as a safety net. |
| Import fails / 400 error | Check browser console. Verify env vars and that CSV columns match the format above. |
| Angbao tab / 🧧 buttons / #pay page are missing | The ang-bao feature is turned off. Set `VITE_ENABLE_ANGBAO=true` (or remove the variable) and rebuild/redeploy. No data is lost while it's off. |
| Confirmation email not arriving | Check Vercel function logs: `vercel logs --environment production --since 1h --source serverless --no-branch --expand`. A `500 Missing env vars` means the Vercel env vars weren't pushed — run `bash scripts/setup-vercel-env.sh`. No log at all means the Supabase Vault secrets aren't configured — run the `vault.create_secret(...)` SQL above. |
| Gmail — "Invalid login" error | Your regular Gmail password won't work. You must use a **Gmail App Password** (16-char code from [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)). Also requires 2-Step Verification to be on. |
| Resend — emails only arrive to your own inbox | You're in Resend sandbox mode (no verified domain yet). Complete Option B above to send to real guests. |
| RSVP triggers email but guest doesn't receive it | Check spam/junk folder. Gmail-to-Gmail or Gmail-to-Outlook may land there occasionally. Ask the guest to mark it not-spam. |
