import { computeVendorMilestones, fmtMoney } from "../lib/budgetUtils.js";

const STATUS_COLORS = {
  enquired: { bg: "rgba(201,168,76,0.1)",  color: "var(--gold-dark)",  label: "Enquired" },
  quoted:   { bg: "rgba(100,149,237,0.12)", color: "#3a6bb5",           label: "Quoted"   },
  booked:   { bg: "rgba(130,217,160,0.15)", color: "#2e7d4f",           label: "Booked"   },
  paid:     { bg: "rgba(130,217,160,0.25)", color: "#1e5c38",           label: "Paid"     },
};

const styles = `
  .vendor-card {
    background: white; border-radius: 10px; padding: 16px 18px;
    box-shadow: var(--shadow); border: 1.5px solid rgba(201,168,76,0.12);
    display: flex; flex-direction: column; gap: 8px;
    transition: border-color 0.15s;
  }
  .vendor-card:hover { border-color: rgba(201,168,76,0.3); }
  .vendor-card-header { display: flex; align-items: center; gap: 10px; }
  .vendor-company { flex: 1; font-size: 15px; font-weight: 500; color: var(--charcoal); }
  .vendor-status-badge {
    font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;
    padding: 3px 9px; border-radius: 20px; flex-shrink: 0;
  }
  .vendor-card-actions { display: flex; gap: 4px; flex-shrink: 0; }
  .vendor-meta { font-size: 12px; color: var(--brown); opacity: 0.7; display: flex; flex-wrap: wrap; gap: 10px; }
  .vendor-milestone-line { font-size: 12px; color: var(--brown); }
  .vendor-overdue { color: var(--red); font-weight: 500; }
`;

export default function VendorCard({ vendor, onEdit, onDelete }) {
  const ms = computeVendorMilestones(vendor.milestones ?? []);
  const st = STATUS_COLORS[vendor.status] ?? STATUS_COLORS.enquired;

  return (
    <>
      <style>{styles}</style>
      <div className="vendor-card">
        <div className="vendor-card-header">
          <div className="vendor-company">{vendor.company_name}</div>
          <span className="vendor-status-badge" style={{ background: st.bg, color: st.color }}>
            {st.label}
          </span>
          <div className="vendor-card-actions">
            <button
              className="icon-btn"
              onClick={onEdit}
              title="Edit vendor"
              style={{ width: 30, height: 30 }}
            >
              ✎
            </button>
            <button
              className="icon-btn danger"
              onClick={onDelete}
              title="Delete vendor"
              style={{ width: 30, height: 30 }}
            >
              ✕
            </button>
          </div>
        </div>

        {(vendor.contact_name || vendor.phone || vendor.email) && (
          <div className="vendor-meta">
            {vendor.contact_name && <span>{vendor.contact_name}</span>}
            {vendor.phone && <span>📞 {vendor.phone}</span>}
            {vendor.email && <span>✉ {vendor.email}</span>}
          </div>
        )}

        {(vendor.milestones ?? []).length > 0 && (
          <div className="vendor-milestone-line">
            {fmtMoney(ms.paid)} paid of {fmtMoney(ms.total)}
            {ms.balance > 0 && ` · ${fmtMoney(ms.balance)} remaining`}
            {ms.overdueCount > 0 && (
              <span className="vendor-overdue">
                {" "}· {ms.overdueCount} overdue
              </span>
            )}
          </div>
        )}

        {vendor.notes && (
          <div style={{ fontSize: 12, color: "var(--brown)", opacity: 0.6, fontStyle: "italic" }}>
            {vendor.notes}
          </div>
        )}
      </div>
    </>
  );
}
