import { supabaseAdmin } from "./_lib/supabaseAdmin.js";
import { sendEmail, getFromAddress, missingEmailEnvVars } from "./_lib/emailProvider.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntil(dateStr) {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const wedding = new Date(dateStr);
  return Math.round((wedding - today) / DAY_MS);
}

// Vercel Cron target (see vercel.json `crons`), runs daily. Sends a one-time
// 90-day-out nudge, then a one-time 30-day-out nudge, to guests still
// `rsvp_status = 'pending'`. `last_reminder_sent_at` is the single dedupe
// column per the roadmap: the 90-day branch only fires while it's still
// null; the 30-day branch is reachable again afterward.
export default async function handler(req, res) {
  const missing = missingEmailEnvVars();
  if (missing.length > 0) {
    return res.status(500).json({ error: `Missing env vars: ${missing.join(", ")}` });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const supabase = supabaseAdmin();
  const { data: wedding } = await supabase.from("weddings").select("*").limit(1).single();
  if (!wedding?.wedding_date) return res.status(200).json({ sent: 0, reason: "wedding not configured yet" });

  const weddingDate = wedding.wedding_date;
  const days = daysUntil(weddingDate);
  if (days > 90) return res.status(200).json({ sent: 0, reason: "more than 90 days out" });

  const { data: guests, error } = await supabase
    .from("guests")
    .select("id, name, email, rsvp_token, last_reminder_sent_at")
    .eq("rsvp_status", "pending")
    .neq("email", "");

  if (error) return res.status(500).json({ error: error.message });

  let fromAddress;
  try {
    fromAddress = getFromAddress();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const coupleNames = `${wedding.bride_name} & ${wedding.groom_name}`;
  const siteUrl = (process.env.SITE_URL || "").replace(/\/$/, "");
  let sent = 0;

  for (const guest of guests) {
    const isFirstReminder = days <= 90 && !guest.last_reminder_sent_at;
    const isSecondReminder = days <= 30 && !isFirstReminder;
    if (!isFirstReminder && !isSecondReminder) continue;

    const rsvpUrl = siteUrl && guest.rsvp_token ? `${siteUrl}/rsvp?token=${guest.rsvp_token}` : "";
    const rsvpButton = rsvpUrl
      ? `<p style="margin:24px 0 0;">
           <a href="${rsvpUrl}"
              style="display:inline-block;padding:12px 28px;background:#c9a97a;color:#fff;
                     font-family:Georgia,serif;font-size:15px;text-decoration:none;border-radius:2px;">
             RSVP Now
           </a>
         </p>`
      : "";

    await sendEmail({
      from: coupleNames,
      fromAddress,
      to: guest.email,
      subject: `Reminder: RSVP for ${coupleNames}'s Wedding`,
      html: `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f9f6f1;font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
    <tr><td style="background:#fffdf9;border-radius:4px;padding:32px 36px;box-shadow:0 1px 4px rgba(0,0,0,.08);">
      <p style="margin:0 0 6px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#9c836a;font-family:Georgia,serif;">${coupleNames}</p>
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:normal;color:#3d2e22;font-family:Georgia,serif;">
        ${isFirstReminder ? "We'd love to know if you can make it." : "Last chance to RSVP."}
      </h1>
      <p style="margin:0;font-size:15px;line-height:1.75;color:#5c4a39;font-family:Georgia,serif;">
        Hi ${guest.name}, just a friendly reminder — our wedding is coming up on
        <strong>${weddingDate}</strong> and we'd love to have your RSVP.
      </p>
      ${rsvpButton}
    </td></tr>
  </table>
</body></html>`,
    });

    await supabase
      .from("guests")
      .update({ last_reminder_sent_at: new Date().toISOString() })
      .eq("id", guest.id);

    sent += 1;
  }

  return res.status(200).json({ sent });
}
