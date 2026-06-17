import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { sb, isDemoMode } from "../lib/supabase.js";
import { theme } from "../shared/theme.js";

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = theme + `
  .rsvp-page {
    min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; padding: 24px;
  }
  .rsvp-card {
    background: white; border-radius: var(--radius); padding: 36px 32px;
    max-width: 440px; width: 100%; text-align: center;
    box-shadow: var(--shadow-lg); border: 1.5px solid rgba(201,168,76,0.2);
  }
  .rsvp-logo { font-family: 'Cormorant Garamond', serif; font-size: 28px; color: var(--gold-dark); margin-bottom: 8px; }
  .rsvp-sub { font-size: 12px; color: var(--brown); opacity: 0.6; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 24px; }
  .rsvp-name { font-family: 'Cormorant Garamond', serif; font-size: 22px; color: var(--charcoal); margin-bottom: 12px; }
  .rsvp-msg { font-size: 14px; color: var(--brown); line-height: 1.6; }
  .rsvp-msg.error { color: var(--red); }
`;

// Public RSVP form, reached via a personalised link of the form
// `/rsvp?token=<rsvp_token>`. The token is looked up through the
// `get_guest_by_rsvp_token` RPC (security definer, granted to `anon`), which
// returns only RSVP-relevant fields for that one guest — never the full
// guest list. The actual form (attendance, meal choice, plus one, dietary
// notes) lands in a later stage; this page proves the routing + RPC plumbing.
export default function RsvpPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState(token ? "loading" : "no-token");
  const [guest, setGuest] = useState(null);

  useEffect(() => {
    if (!token) { setStatus("no-token"); return; }
    if (isDemoMode) { setGuest({ name: "Demo Guest" }); setStatus("ready"); return; }

    let cancelled = false;
    setStatus("loading");
    sb.rpc("get_guest_by_rsvp_token", { p_token: token })
      .then((rows) => {
        if (cancelled) return;
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (row) { setGuest(row); setStatus("ready"); }
        else setStatus("invalid");
      })
      .catch(() => { if (!cancelled) setStatus("invalid"); });
    return () => { cancelled = true; };
  }, [token]);

  return (
    <>
      <style>{styles}</style>
      <div className="rsvp-page">
        <div className="rsvp-card">
          <div className="rsvp-logo">♡ You're Invited</div>
          <div className="rsvp-sub">RSVP</div>
          {status === "loading" && <div className="rsvp-msg">Loading your invitation…</div>}
          {status === "ready" && guest && (
            <>
              <div className="rsvp-name">Hi {guest.name} 👋</div>
              <div className="rsvp-msg">
                The RSVP form is coming soon — check back shortly to confirm your
                attendance, meal choice, and more.
              </div>
            </>
          )}
          {status === "invalid" && (
            <div className="rsvp-msg error">
              We couldn't find an invitation for this link. Please check the link
              or contact the couple directly.
            </div>
          )}
          {status === "no-token" && (
            <div className="rsvp-msg">
              This RSVP page needs a personalised link. If you received one by
              email or message, please use that link.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
