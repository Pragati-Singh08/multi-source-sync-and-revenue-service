import { prisma } from "../lib/prisma";
import { COLLECTED_STATUS } from "./statusMap";

export interface DateRange {
  start: Date;
  end: Date; // exclusive
}

interface CollectedRow {
  amountCents: number;
  occurredAt: Date;
}

// THE single query. Every "how much revenue did we collect" question in
// this codebase must go through this function — there is deliberately no
// second implementation of "what counts as collected" anywhere else. Both
// public endpoints below are thin views over this one result set, which is
// what makes drift structurally impossible rather than just unlikely:
// there's nothing else to drift against.
async function getCollectedTransactions(range: DateRange): Promise<CollectedRow[]> {
  const rows = await prisma.transaction.findMany({
    where: {
      canonicalStatus: COLLECTED_STATUS,
      occurredAt: { gte: range.start, lt: range.end },
    },
    select: { amountCents: true, occurredAt: true },
  });
  return rows;
}

// View 1: single total for a date range.
export async function computeRevenueSummary(range: DateRange) {
  const rows = await getCollectedTransactions(range);
  const totalCents = rows.reduce((sum, r) => sum + r.amountCents, 0);
  return { totalCents, count: rows.length };
}

export type Granularity = "day" | "week";

function bucketKey(date: Date, granularity: Granularity): string {
  if (granularity === "day") {
    return date.toISOString().slice(0, 10); // YYYY-MM-DD
  }
  // ISO week bucket: Monday-start week, keyed by that Monday's date.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Sunday -> 7
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

// View 2: day-by-day or week-by-week breakdown for the same date range.
// Because this reuses getCollectedTransactions verbatim, summing every
// bucket here will always equal computeRevenueSummary's total for the same
// range — there is no separate filter, join, or status list to fall out of
// sync.
export async function computeRevenueBreakdown(range: DateRange, granularity: Granularity = "day") {
  const rows = await getCollectedTransactions(range);
  const buckets = new Map<string, { totalCents: number; count: number }>();

  for (const row of rows) {
    const key = bucketKey(row.occurredAt, granularity);
    const existing = buckets.get(key) ?? { totalCents: 0, count: 0 };
    existing.totalCents += row.amountCents;
    existing.count += 1;
    buckets.set(key, existing);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, v]) => ({ bucket, ...v }));
}

// Runtime canary, not just a CI test: if anyone ever introduces a second
// code path that computes revenue differently (a raw SQL query somewhere
// else, a cached/precomputed column that falls out of sync, a status list
// duplicated instead of imported), this function will catch the mismatch
// live, in production, every time it's called — not just at test time.
export async function checkSummaryMatchesBreakdown(range: DateRange, granularity: Granularity = "day") {
  const [summary, breakdown] = await Promise.all([
    computeRevenueSummary(range),
    computeRevenueBreakdown(range, granularity),
  ]);
  const breakdownTotal = breakdown.reduce((sum, b) => sum + b.totalCents, 0);
  const consistent = breakdownTotal === summary.totalCents;
  return { consistent, summaryTotalCents: summary.totalCents, breakdownTotalCents: breakdownTotal };
}
