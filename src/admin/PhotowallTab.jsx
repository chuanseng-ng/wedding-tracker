// Photowall moderation tab (#138) — couple-only. Lists every guest photo
// (live, hidden, and stuck-pending), with hide/unhide (direct RLS table
// update) and delete (via /api/photowall so the storage object is removed
// too). Follows the Submissions tab's list-of-rows moderation pattern.
import { useState, useEffect, useCallback } from "react";
import { sb, supabase, isDemoMode } from "../lib/supabase.js";

const styles = `
  .pw-admin-list { display: flex; flex-direction: column; gap: 10px; }
  .pw-admin-row {
    display: flex; align-items: center; gap: 14px;
    background: white; border: 1px solid rgba(0,0,0,0.08);
    border-radius: var(--radius); padding: 10px 14px;
    box-shadow: var(--shadow);
  }
  .pw-admin-row.is-hidden { opacity: 0.55; }
  .pw-admin-thumb {
    width: 72px; height: 72px; object-fit: cover; border-radius: 8px;
    background: var(--warm-white); flex-shrink: 0;
  }
  .pw-admin-caption { font-size: 14px; color: var(--charcoal); overflow-wrap: anywhere; }
  .pw-admin-meta { font-size: 12px; color: var(--brown); opacity: 0.7; margin-top: 2px; }
  .pw-admin-status {
    font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase;
    padding: 3px 8px; border-radius: 999px; flex-shrink: 0;
  }
  .pw-admin-status.live    { background: var(--green-soft); color: var(--green); }
  .pw-admin-status.hidden  { background: var(--red-soft); color: var(--red); }
  .pw-admin-status.pending { background: var(--warm-white); color: var(--brown); }
  .pw-admin-actions { display: flex; gap: 8px; flex-shrink: 0; }
`;

function formatTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-SG", {
      day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function PhotowallTab({ showToast }) {
  const [photos, setPhotos] = useState(null);
  const [busyId, setBusyId] = useState(null);
  // Two-click delete (no browser confirm dialogs in this app): the first
  // click arms the button, the second within the armed state deletes.
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const load = useCallback(async () => {
    if (isDemoMode) {
      setPhotos([]);
      return;
    }
    try {
      const rows = await sb.listPhotowallPhotos();
      setPhotos(Array.isArray(rows) ? rows : []);
    } catch {
      // Table absent on un-migrated DBs — show the empty state.
      setPhotos((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    return sb.subscribeToChanges("photowall_photos", load);
  }, [load]);

  const toggleHidden = async (photo) => {
    const next = photo.status === "hidden" ? "live" : "hidden";
    setBusyId(photo.id);
    try {
      await sb.setPhotowallStatus(photo.id, next);
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, status: next } : p)));
      showToast(next === "hidden" ? "Photo hidden from the wall" : "Photo is live again");
    } catch {
      showToast("Could not update photo — check connection");
    } finally {
      setBusyId(null);
    }
  };

  const deletePhoto = async (photo) => {
    if (confirmDeleteId !== photo.id) {
      setConfirmDeleteId(photo.id);
      return;
    }
    setConfirmDeleteId(null);
    setBusyId(photo.id);
    try {
      const { data: { session } = {} } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/photowall", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: "delete", photoId: photo.id }),
      });
      if (!res.ok) throw new Error(`delete failed: ${res.status}`);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      showToast("Photo deleted");
    } catch {
      showToast("Could not delete photo — check connection");
    } finally {
      setBusyId(null);
    }
  };

  if (isDemoMode) {
    return (
      <>
        <style>{styles}</style>
        <div className="empty">
          <div className="empty-icon">📸</div>
          <div className="empty-text">Photowall is not available in demo mode</div>
          <div className="empty-sub">Connect Supabase and a photo storage provider to collect guest photos.</div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{styles}</style>
      {!photos || photos.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📸</div>
          <div className="empty-text">No guest photos yet</div>
          <div className="empty-sub">
            Enable the photowall (and set its PIN) in Wedding Setup, then share the PIN with
            your guests — their photos land here and on the wedding page.
          </div>
        </div>
      ) : (
        <div className="pw-admin-list">
          {photos.map((p) => (
            <div key={p.id} className={`pw-admin-row is-${p.status}`}>
              {p.public_url ? (
                <a href={p.public_url} target="_blank" rel="noopener noreferrer">
                  <img className="pw-admin-thumb" src={p.public_url} alt="" loading="lazy" />
                </a>
              ) : (
                <div className="pw-admin-thumb" />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pw-admin-caption">{p.caption || <em>No caption</em>}</div>
                <div className="pw-admin-meta">
                  {p.uploader_name || "Anonymous"} · {formatTime(p.created_at)}
                </div>
              </div>
              <span className={`pw-admin-status ${p.status}`}>{p.status}</span>
              <div className="pw-admin-actions">
                {p.status !== "pending" && (
                  <button
                    className="btn btn-outline btn-sm"
                    disabled={busyId === p.id}
                    onClick={() => toggleHidden(p)}
                  >
                    {p.status === "hidden" ? "Unhide" : "Hide"}
                  </button>
                )}
                <button
                  className={`btn btn-sm ${confirmDeleteId === p.id ? "btn-gold" : "btn-outline"}`}
                  disabled={busyId === p.id}
                  onClick={() => deletePhoto(p)}
                  onBlur={() => setConfirmDeleteId((id) => (id === p.id ? null : id))}
                  title={confirmDeleteId === p.id ? "Removes the photo and its file permanently" : undefined}
                >
                  {confirmDeleteId === p.id ? "Really delete?" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
