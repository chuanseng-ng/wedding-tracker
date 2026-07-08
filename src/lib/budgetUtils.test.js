import { describe, it, expect } from "vitest";
import {
  computeVendorMilestones,
  computeCategoryStats,
  computeOverallStats,
} from "./budgetUtils.js";

const TODAY = "2026-07-08";

// ── computeVendorMilestones ────────────────────────────────────────────────────

describe("computeVendorMilestones", () => {
  it("returns all zeroes for empty milestones", () => {
    const r = computeVendorMilestones([], TODAY);
    expect(r).toEqual({ total: 0, paid: 0, balance: 0, overdueCount: 0, nextDue: null });
  });

  it("sums all milestone amounts as total regardless of paid status", () => {
    const milestones = [
      { label: "Deposit", amount: 1000, due_date: "2026-01-01", paid: true },
      { label: "Final",   amount: 2000, due_date: "2026-08-01", paid: false },
    ];
    const r = computeVendorMilestones(milestones, TODAY);
    expect(r.total).toBe(3000);
  });

  it("sums only paid milestones as paid", () => {
    const milestones = [
      { label: "Deposit", amount: 1000, due_date: "2026-01-01", paid: true },
      { label: "Final",   amount: 2000, due_date: "2026-08-01", paid: false },
    ];
    const r = computeVendorMilestones(milestones, TODAY);
    expect(r.paid).toBe(1000);
  });

  it("computes balance as total minus paid", () => {
    const milestones = [
      { label: "Deposit",   amount: 500,  due_date: "2026-01-01", paid: true },
      { label: "Midpoint",  amount: 500,  due_date: "2026-04-01", paid: true },
      { label: "Final",     amount: 1000, due_date: "2026-08-01", paid: false },
    ];
    const r = computeVendorMilestones(milestones, TODAY);
    expect(r.balance).toBe(1000);
  });

  it("counts overdue as unpaid milestones with due_date before today", () => {
    const milestones = [
      { label: "Deposit", amount: 500, due_date: "2026-01-01", paid: false },
      { label: "Past",    amount: 500, due_date: "2026-06-01", paid: false },
      { label: "Future",  amount: 500, due_date: "2026-09-01", paid: false },
    ];
    const r = computeVendorMilestones(milestones, TODAY);
    expect(r.overdueCount).toBe(2);
  });

  it("does not count paid milestones as overdue even when past due", () => {
    const milestones = [
      { label: "Deposit", amount: 500, due_date: "2026-01-01", paid: true },
    ];
    const r = computeVendorMilestones(milestones, TODAY);
    expect(r.overdueCount).toBe(0);
  });

  it("returns nextDue as earliest unpaid future milestone", () => {
    const milestones = [
      { label: "Far",    amount: 500, due_date: "2026-12-01", paid: false },
      { label: "Sooner", amount: 500, due_date: "2026-08-01", paid: false },
    ];
    const r = computeVendorMilestones(milestones, TODAY);
    expect(r.nextDue?.label).toBe("Sooner");
  });

  it("returns nextDue null when all unpaid milestones have no due_date", () => {
    const milestones = [{ label: "TBD", amount: 500, due_date: "", paid: false }];
    const r = computeVendorMilestones(milestones, TODAY);
    expect(r.nextDue).toBeNull();
  });

  it("treats non-numeric amount strings as 0", () => {
    const milestones = [{ label: "TBD", amount: "", due_date: "", paid: false }];
    const r = computeVendorMilestones(milestones, TODAY);
    expect(r.total).toBe(0);
  });
});

// ── computeCategoryStats ───────────────────────────────────────────────────────

const CAT_PHOTO = { key: "photo", label: "Photography", cap: 5000 };
const CAT_VENUE = { key: "venue", label: "Venue",       cap: 10000 };
const CAT_MISC  = { key: "misc",  label: "Misc",         cap: 0 };

describe("computeCategoryStats", () => {
  it("returns zeros for categories with no vendors", () => {
    const r = computeCategoryStats([CAT_PHOTO], []);
    expect(r[0]).toMatchObject({ committed: 0, paid: 0, isOverBudget: false });
  });

  it("flags isOverBudget when committed exceeds cap", () => {
    const vendors = [
      { category_key: "photo", milestones: [{ amount: 6000, paid: false }] },
    ];
    const r = computeCategoryStats([CAT_PHOTO], vendors);
    expect(r[0].isOverBudget).toBe(true);
  });

  it("does not flag isOverBudget when cap is 0 (no cap set)", () => {
    const vendors = [
      { category_key: "misc", milestones: [{ amount: 99999, paid: false }] },
    ];
    const r = computeCategoryStats([CAT_MISC], vendors);
    expect(r[0].isOverBudget).toBe(false);
  });

  it("counts vendors only in their matching category", () => {
    const vendors = [
      { category_key: "photo", milestones: [{ amount: 3000, paid: false }] },
      { category_key: "venue", milestones: [{ amount: 8000, paid: false }] },
    ];
    const r = computeCategoryStats([CAT_PHOTO, CAT_VENUE], vendors);
    expect(r[0].committed).toBe(3000);
    expect(r[1].committed).toBe(8000);
  });

  it("counts only paid milestones in paid field", () => {
    const vendors = [
      {
        category_key: "photo",
        milestones: [
          { amount: 1000, paid: true },
          { amount: 2000, paid: false },
        ],
      },
    ];
    const r = computeCategoryStats([CAT_PHOTO], vendors);
    expect(r[0].paid).toBe(1000);
    expect(r[0].committed).toBe(3000);
  });
});

// ── computeOverallStats ────────────────────────────────────────────────────────

describe("computeOverallStats", () => {
  it("returns zeros for empty vendor list", () => {
    const r = computeOverallStats(18000, []);
    expect(r).toEqual({ totalCommitted: 0, totalPaid: 0, isOverBudget: false });
  });

  it("flags isOverBudget when totalCommitted exceeds overallCap", () => {
    const vendors = [
      { milestones: [{ amount: 10000, paid: false }] },
      { milestones: [{ amount: 10000, paid: false }] },
    ];
    const r = computeOverallStats(18000, vendors);
    expect(r.isOverBudget).toBe(true);
    expect(r.totalCommitted).toBe(20000);
  });

  it("does not flag isOverBudget when overallCap is 0", () => {
    const vendors = [{ milestones: [{ amount: 99999, paid: false }] }];
    const r = computeOverallStats(0, vendors);
    expect(r.isOverBudget).toBe(false);
  });

  it("sums only paid milestones as totalPaid", () => {
    const vendors = [
      {
        milestones: [
          { amount: 500, paid: true },
          { amount: 500, paid: false },
        ],
      },
    ];
    const r = computeOverallStats(5000, vendors);
    expect(r.totalPaid).toBe(500);
    expect(r.totalCommitted).toBe(1000);
  });
});
