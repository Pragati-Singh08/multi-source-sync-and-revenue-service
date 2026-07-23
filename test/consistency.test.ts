import { prisma } from "../src/lib/prisma";
import {
  computeRevenueSummary,
  computeRevenueBreakdown,
  checkSummaryMatchesBreakdown,
} from "../src/metrics/revenueService";

const RANGE = { start: new Date("2000-01-01"), end: new Date("2100-01-01") };

describe("drift-proof revenue metric (Problem 2)", () => {
  beforeAll(async () => {
    // Clear all existing transactions first so we start fresh
    await prisma.transaction.deleteMany();
    
    // Three "collected" transactions across two different source systems'
    // vocabularies, plus one unmapped status that must NOT count.
    await prisma.transaction.createMany({
      data: [
        {
          sourceSystem: "test_stripe",
          externalId: "t1",
          rawStatus: "succeeded",
          canonicalStatus: "collected",
          amountCents: 1000,
          occurredAt: new Date("2050-01-01"),
          raw: {},
        },
        {
          sourceSystem: "test_invoicer",
          externalId: "t2",
          rawStatus: "paid",
          canonicalStatus: "collected",
          amountCents: 2500,
          occurredAt: new Date("2050-01-02"),
          raw: {},
        },
        {
          sourceSystem: "test_invoicer",
          externalId: "t3",
          rawStatus: "brand_new_status_nobody_mapped_yet",
          canonicalStatus: "unmapped",
          amountCents: 999999,
          occurredAt: new Date("2050-01-02"),
          raw: {},
        },
      ],
      skipDuplicates: true,
    });
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({
      where: { externalId: { in: ["t1", "t2", "t3"] } },
    });
    await prisma.$disconnect();
  });

  it("summary and breakdown always agree for the same range", async () => {
    const summary = await computeRevenueSummary(RANGE);
    const breakdown = await computeRevenueBreakdown(RANGE, "day");
    const breakdownTotal = breakdown.reduce((sum, b) => sum + b.totalCents, 0);

    expect(breakdownTotal).toBe(summary.totalCents);
  });

  it("the consistency-check helper reports consistent: true", async () => {
    const result = await checkSummaryMatchesBreakdown(RANGE, "day");
    expect(result.consistent).toBe(true);
  });

  it("an unmapped status is excluded from revenue even though it's a huge amount", async () => {
    const summary = await computeRevenueSummary(RANGE);
    // 1000 + 2500 = 3500. If the 999999-cent unmapped row leaked in, this
    // assertion fails loudly.
    expect(summary.totalCents).toBe(3500);
  });
});
