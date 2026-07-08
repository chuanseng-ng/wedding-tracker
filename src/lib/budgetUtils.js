// Pure budget computation functions — no side effects, fully testable.
// Milestone shape: { label: string, amount: number, due_date: string, paid: boolean }
// BudgetCategory shape: { key: string, label: string, cap: number }
// Vendor shape: { id, category_key, company_name, milestones: Milestone[], ... }

/**
 * Derive display fields for a single vendor's milestone list.
 * Pass todayISO (YYYY-MM-DD) to make overdue detection deterministic in tests.
 */
export function computeVendorMilestones(milestones, todayISO) {
  const today = todayISO ?? new Date().toISOString().slice(0, 10);
  const total = milestones.reduce((s, m) => s + (Number(m.amount) || 0), 0);
  const paid  = milestones
    .filter((m) => m.paid)
    .reduce((s, m) => s + (Number(m.amount) || 0), 0);
  const balance = total - paid;
  const overdueCount = milestones.filter(
    (m) => !m.paid && m.due_date && m.due_date < today
  ).length;
  const nextDue = milestones
    .filter((m) => !m.paid && m.due_date)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null;

  return { total, paid, balance, overdueCount, nextDue };
}

/**
 * Per-category spend breakdown.
 * Returns array of { category, committed, paid, isOverBudget }.
 * "committed" = sum of all milestone amounts for vendors in that category.
 * "paid"      = sum of paid milestones only.
 */
export function computeCategoryStats(categories, vendors) {
  return categories.map((cat) => {
    const catVendors = vendors.filter((v) => v.category_key === cat.key);
    const committed = catVendors.reduce(
      (s, v) => s + v.milestones.reduce((ms, m) => ms + (Number(m.amount) || 0), 0),
      0
    );
    const paid = catVendors.reduce(
      (s, v) =>
        s + v.milestones.filter((m) => m.paid).reduce((ms, m) => ms + (Number(m.amount) || 0), 0),
      0
    );
    const isOverBudget = cat.cap > 0 && committed > cat.cap;
    return { category: cat, committed, paid, isOverBudget };
  });
}

/**
 * Top-level budget summary across all vendors.
 */
export function computeOverallStats(overallCap, vendors) {
  const totalCommitted = vendors.reduce(
    (s, v) => s + v.milestones.reduce((ms, m) => ms + (Number(m.amount) || 0), 0),
    0
  );
  const totalPaid = vendors.reduce(
    (s, v) =>
      s + v.milestones.filter((m) => m.paid).reduce((ms, m) => ms + (Number(m.amount) || 0), 0),
    0
  );
  const isOverBudget = overallCap > 0 && totalCommitted > overallCap;
  return { totalCommitted, totalPaid, isOverBudget };
}

/** Format a number as a dollar amount with thousands separator. */
export function fmtMoney(n) {
  if (!n && n !== 0) return "$0";
  return "$" + Math.round(n).toLocaleString();
}
