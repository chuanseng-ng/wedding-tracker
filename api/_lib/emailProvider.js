import { Resend } from "resend";
import { BrevoClient } from "@getbrevo/brevo";

// Unified email sender. Set EMAIL_PROVIDER=resend (default) or EMAIL_PROVIDER=brevo.
//
// Resend setup:  RESEND_API_KEY + (RESEND_FROM_EMAIL or RESEND_SENDING_DOMAIN)
// Brevo setup:   BREVO_API_KEY  + BREVO_FROM_EMAIL
//
// Switching providers = change EMAIL_PROVIDER in Vercel env vars. No code change needed.

/**
 * @param {object} opts
 * @param {string} opts.from        Display name, e.g. "Wei Ming & Siew Yong"
 * @param {string} opts.fromAddress e.g. "rsvp@yourdomain.com"
 * @param {string} opts.to          Recipient email
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {Array<{filename: string, content: string}>} [opts.attachments]  base64 content
 */
export async function sendEmail({ from, fromAddress, to, subject, html, attachments = [] }) {
  const provider = (process.env.EMAIL_PROVIDER || "resend").toLowerCase();

  if (provider === "brevo") {
    return sendViaBrevo({ from, fromAddress, to, subject, html, attachments });
  }
  return sendViaResend({ from, fromAddress, to, subject, html, attachments });
}

export function getFromAddress() {
  const provider = (process.env.EMAIL_PROVIDER || "resend").toLowerCase();
  if (provider === "brevo") {
    const addr = process.env.BREVO_FROM_EMAIL;
    if (!addr) throw new Error("Missing BREVO_FROM_EMAIL");
    return addr;
  }
  const addr = process.env.RESEND_FROM_EMAIL || `rsvp@${process.env.RESEND_SENDING_DOMAIN}`;
  if (!addr || addr === "rsvp@undefined") throw new Error("Missing RESEND_FROM_EMAIL or RESEND_SENDING_DOMAIN");
  return addr;
}

// Returns a list of missing required env var names for the configured provider.
// Call at the top of each API handler to catch misconfiguration early.
export function missingEmailEnvVars() {
  const provider = (process.env.EMAIL_PROVIDER || "resend").toLowerCase();
  const missing = [];

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (provider === "brevo") {
    if (!process.env.BREVO_API_KEY) missing.push("BREVO_API_KEY");
    if (!process.env.BREVO_FROM_EMAIL) missing.push("BREVO_FROM_EMAIL");
  } else {
    if (!process.env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
    const hasFrom = process.env.RESEND_FROM_EMAIL || process.env.RESEND_SENDING_DOMAIN;
    if (!hasFrom) missing.push("RESEND_FROM_EMAIL (or RESEND_SENDING_DOMAIN)");
  }

  return missing;
}

async function sendViaResend({ from, fromAddress, to, subject, html, attachments }) {
  if (!process.env.RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY");
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: `${from} <${fromAddress}>`,
    to,
    subject,
    html,
    ...(attachments.length > 0 && { attachments }),
  });
}

async function sendViaBrevo({ from, fromAddress, to, subject, html, attachments }) {
  if (!process.env.BREVO_API_KEY) throw new Error("Missing BREVO_API_KEY");

  const client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });

  await client.transactionalEmails.sendTransacEmail({
    sender: { name: from, email: fromAddress },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    ...(attachments.length > 0 && {
      attachment: attachments.map(({ filename, content }) => ({ name: filename, content })),
    }),
  });
}
