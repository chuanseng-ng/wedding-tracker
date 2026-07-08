import { useState } from "react";
import MilestoneEditor from "./MilestoneEditor.jsx";

const BLANK = {
  company_name: "",
  contact_name: "",
  phone: "",
  email: "",
  website: "",
  notes: "",
  status: "enquired",
  category_key: "",
  milestones: [],
  arrival_time: "",
};

export default function VendorModal({ mode, vendor, categories, onSave, onClose }) {
  const [form, setForm] = useState(() => ({
    ...BLANK,
    ...(vendor ?? {}),
    milestones: (vendor?.milestones ?? []).map((m) => ({ ...m })),
  }));
  const [saving, setSaving] = useState(false);

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const handleSave = async () => {
    if (!form.company_name.trim()) return;
    setSaving(true);
    await onSave({
      ...form,
      company_name: form.company_name.trim(),
      milestones: form.milestones.map((m) => ({
        ...m,
        amount: Number(m.amount) || 0,
      })),
    });
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">
          {mode === "edit" ? "Edit Vendor" : "Add Vendor"}
        </div>

        <div className="form-grid">
          {/* Company + Category */}
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Company / Vendor name *</label>
              <input
                className="form-input"
                autoFocus
                placeholder="e.g. XYZ Photography"
                value={form.company_name}
                onChange={(e) => set("company_name", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Category</label>
              <select
                className="form-input"
                value={form.category_key}
                onChange={(e) => set("category_key", e.target.value)}
              >
                <option value="">— None —</option>
                {categories.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Status */}
          <div className="form-group">
            <label className="form-label">Status</label>
            <select
              className="form-input"
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
            >
              <option value="enquired">Enquired</option>
              <option value="quoted">Quoted</option>
              <option value="booked">Booked</option>
              <option value="paid">Paid in Full</option>
            </select>
          </div>

          {/* Contact */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Contact person</label>
              <input
                className="form-input"
                placeholder="Name"
                value={form.contact_name}
                onChange={(e) => set("contact_name", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input
                className="form-input"
                type="tel"
                placeholder="+65 9123 4567"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="form-input"
                type="email"
                placeholder="vendor@email.com"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Website</label>
              <input
                className="form-input"
                type="url"
                placeholder="https://..."
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
              />
            </div>
          </div>

          {/* Notes */}
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea
              className="form-input"
              rows={2}
              placeholder="Contract details, special requirements…"
              style={{ resize: "vertical" }}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>

          {/* Arrival time (reserved for D-Day timeline) */}
          <div className="form-group">
            <label className="form-label">Arrival time (D-Day)</label>
            <input
              className="form-input"
              type="time"
              value={form.arrival_time ?? ""}
              onChange={(e) => set("arrival_time", e.target.value)}
            />
          </div>

          {/* Milestones */}
          <div className="form-group" style={{ gridColumn: "1 / -1" }}>
            <label className="form-label">Payment milestones</label>
            <MilestoneEditor
              milestones={form.milestones}
              onChange={(milestones) => set("milestones", milestones)}
            />
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-gold"
            onClick={handleSave}
            disabled={saving || !form.company_name.trim()}
          >
            {saving ? "Saving…" : mode === "edit" ? "Save Changes" : "Add Vendor"}
          </button>
        </div>
      </div>
    </div>
  );
}
