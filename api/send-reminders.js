import { Resend } from "resend";
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

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
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const weddingDate = process.env.WEDDING_DATE;
  if (!weddingDate) return res.status(500).json({ error: "WEDDING_DATE not configured" });

  const days = daysUntil(weddingDate);
  if (days > 90) return res.status(200).json({ sent: 0, reason: "more than 90 days out" });

  const supabase = supabaseAdmin();
  const { data: guests, error } = await supabase
    .from("guests")
    .select("id, name, email, last_reminder_sent_at")
    .eq("rsvp_status", "pending")
    .neq("email", "");

  if (error) return res.status(500).json({ error: error.message });

  const resend = new Resend(process.env.RESEND_API_KEY);
  const coupleNames = process.env.COUPLE_NAMES || "The Happy Couple";
  let sent = 0;

  for (const guest of guests) {
    const isFirstReminder = days <= 90 && !guest.last_reminder_sent_at;
    const isSecondReminder = days <= 30 && !isFirstReminder;
    if (!isFirstReminder && !isSecondReminder) continue;

    await resend.emails.send({
      from: `${coupleNames} <rsvp@${process.env.RESEND_SENDING_DOMAIN}>`,
      to: guest.email,
      subject: `Reminder: RSVP for ${coupleNames}'s Wedding`,
      html: `<p>Hi ${guest.name},</p><p>Just a friendly reminder to RSVP for our wedding on ${weddingDate} — we'd love to know if you can make it!</p>`,
    });

    await supabase
      .from("guests")
      .update({ last_reminder_sent_at: new Date().toISOString() })
      .eq("id", guest.id);

    sent += 1;
  }

  return res.status(200).json({ sent });
}
