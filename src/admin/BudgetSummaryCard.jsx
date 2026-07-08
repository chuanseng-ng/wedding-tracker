import { useState } from "react";
import { computeCategoryStats, computeOverallStats, fmtMoney } from "../lib/budgetUtils.js";

const styles = `
  .budget-summary-card {
    background: var(--charcoal); border-radius: var(--radius);
    padding: 24px 28px; margin-bottom: 24px;
    border: 1px solid rgba(201,168,76,0.2);
  }
  .budget-summary-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 16px;
  }
  .budget-summary-title {
    font-family: 'Cormorant Garamond', serif; font-size: 18px;
    color: var(--gold-light); font-weight: 400;
  }
  .budget-overall {
    display: flex; gap: 24px; align-items: center; margin-bottom: 20px;
  }
  .budget-big-num {
    font-family: 'Cormorant Garamond', serif; font-size: 32px;
    color: var(--gold-light); font-weight: 400;
  }
  .budget-big-label {
    font-size: 11px; color: rgba(255,255,255,0.4);
    text-transform: uppercase; letter-spacing: 0.1em;
  }
  .budget-big-divider { width: 1px; height: 44px; background: rgba(255,255,255,0.1); }
  .budget-overall-bar {
    flex: 1; height: 6px; background: rgba(255,255,255,0.1);
    border-radius: 3px; overflow: hidden; margin-top: 4px;
  }
  .budget-overall-bar-fill {
    height: 100%; border-radius: 3px; transition: width 0.4s ease;
  }
  .budget-cat-list { display: flex; flex-direction: column; gap: 6px; }
  .budget-cat-row {
    display: grid; grid-template-columns: 1fr 100px 140px;
    gap: 8px; align-items: center;
    padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.06);
  }
  .budget-cat-name { font-size: 13px; color: rgba(255,255,255,0.75); }
  .budget-cat-amounts { font-size: 12px; color: rgba(255,255,255,0.45); text-align: right; }
  .budget-cat-bar-wrap { position: relative; height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; }
  .budget-cat-bar-fill { position: absolute; left: 0; top: 0; height: 100%; border-radius: 2px; transition: width 0.3s ease; }
  .budget-over { color: #f1948a !important; }
  .cap-edit-form { display: flex; align-items: center; gap: 8px; }
  .cap-edit-input {
    width: 120px; padding: 6px 8px; border-radius: 6px;
    border: 1.5px solid rgba(201,168,76,0.4); background: rgba(255,255,255,0.08);
    color: white; font-family: 'DM Sans', sans-serif; font-size: 13px; outline: none;
  }
  .cap-edit-input:focus { border-color: var(--gold); }
  .cap-save-btn {
    padding: 5px 12px; border-radius: 6px; border: none; cursor: pointer;
    background: var(--gold); color: #1a1a1a; font-size: 12px; font-weight: 600;
  }
  .cap-cancel-btn {
    padding: 5px 10px; border-radius: 6px; border: none; cursor: pointer;
    background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.6); font-size: 12px;
  }
  .cap-hint-btn {
    background: none; border: none; cursor: pointer;
    color: rgba(255,255,255,0.3); font-size: 11px; letter-spacing: 0.05em;
    text-decoration: underline; font-family: 'DM Sans', sans-serif; padding: 0;
    transition: color 0.15s;
  }
  .cap-hint-btn:hover { color: var(--gold-light); }
`;

export default function BudgetSummaryCard({
  overallCap,
  categories,
  vendors,
  onEditCap,
  onManageCategories,
}) {
  const [editingCap, setEditingCap] = useState(false);
  const [capInput, setCapInput] = useState("");

  const overall = computeOverallStats(overallCap, vendors);
  const catStats = computeCategoryStats(categories, vendors);

  const pct = overallCap > 0
    ? Math.min(100, (overall.totalCommitted / overallCap) * 100)
    : 0;
  const barColor = overall.isOverBudget
    ? "#f1948a"
    : pct > 80 ? "#f0c060" : "#82d9a0";

  const startEditCap = () => {
    setCapInput(overallCap > 0 ? String(overallCap) : "");
    setEditingCap(true);
  };

  const saveCap = () => {
    onEditCap(Number(capInput) || 0);
    setEditingCap(false);
  };

  return (
    <>
      <style>{styles}</style>
      <div className="budget-summary-card">
        <div className="budget-summary-header">
          <div className="budget-summary-title">Budget Overview</div>
          <button className="cap-hint-btn" onClick={onManageCategories}>
            Manage categories →
          </button>
        </div>

        {/* Overall cap row */}
        <div className="budget-overall">
          <div>
            <div className={`budget-big-num ${overall.isOverBudget ? "budget-over" : ""}`}>
              {fmtMoney(overall.totalCommitted)}
            </div>
            <div className="budget-big-label">Committed</div>
          </div>
          <div className="budget-big-divider" />
          <div>
            <div className="budget-big-num" style={{ fontSize: 22, color: "#82d9a0" }}>
              {fmtMoney(overall.totalPaid)}
            </div>
            <div className="budget-big-label">Paid</div>
          </div>
          <div className="budget-big-divider" />
          <div style={{ flex: 1 }}>
            {editingCap ? (
              <div className="cap-edit-form">
                <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Cap $</span>
                <input
                  className="cap-edit-input"
                  type="number"
                  min="0"
                  autoFocus
                  value={capInput}
                  onChange={(e) => setCapInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveCap(); if (e.key === "Escape") setEditingCap(false); }}
                />
                <button className="cap-save-btn" onClick={saveCap}>OK</button>
                <button className="cap-cancel-btn" onClick={() => setEditingCap(false)}>✕</button>
              </div>
            ) : (
              <>
                <div className="budget-big-num" style={{ fontSize: 22, color: "rgba(255,255,255,0.5)" }}>
                  {overallCap > 0 ? fmtMoney(overallCap) : "—"}
                </div>
                <button className="cap-hint-btn" style={{ marginTop: 2 }} onClick={startEditCap}>
                  {overallCap > 0 ? "edit total budget" : "set total budget"}
                </button>
              </>
            )}
            {!editingCap && overallCap > 0 && (
              <div className="budget-overall-bar" style={{ marginTop: 8 }}>
                <div
                  className="budget-overall-bar-fill"
                  style={{ width: `${pct}%`, background: barColor }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Per-category rows */}
        {catStats.length > 0 && (
          <div className="budget-cat-list">
            {catStats.map(({ category, committed, isOverBudget }) => {
              const catPct = category.cap > 0
                ? Math.min(100, (committed / category.cap) * 100)
                : committed > 0 ? 100 : 0;
              const catColor = isOverBudget ? "#f1948a" : catPct > 80 ? "#f0c060" : "var(--gold)";
              return (
                <div key={category.key} className="budget-cat-row">
                  <div className={`budget-cat-name ${isOverBudget ? "budget-over" : ""}`}>
                    {category.label}
                    {isOverBudget && " ⚠"}
                  </div>
                  <div className="budget-cat-amounts">
                    {fmtMoney(committed)}
                    {category.cap > 0 && (
                      <span style={{ opacity: 0.5 }}> / {fmtMoney(category.cap)}</span>
                    )}
                  </div>
                  <div className="budget-cat-bar-wrap">
                    <div
                      className="budget-cat-bar-fill"
                      style={{ width: `${catPct}%`, background: catColor }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
