import { Router } from "express";
import { z } from "zod";
import {
  computeRevenueBreakdown,
  computeRevenueSummary,
  checkSummaryMatchesBreakdown,
  Granularity,
} from "../metrics/revenueService";

export const metricsRouter = Router();

const rangeSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
  granularity: z.enum(["day", "week"]).optional(),
});

function parseRange(query: any) {
  const parsed = rangeSchema.safeParse(query);
  if (!parsed.success) {
    throw { status: 400, body: parsed.error.flatten() };
  }
  const start = new Date(parsed.data.start);
  const end = new Date(parsed.data.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw { status: 400, body: { error: "start/end must be valid ISO dates" } };
  }
  return { range: { start, end }, granularity: (parsed.data.granularity ?? "day") as Granularity };
}

// View 1: single total. e.g. GET /metrics/revenue/summary?start=2026-07-01&end=2026-08-01
metricsRouter.get("/metrics/revenue/summary", async (req, res) => {
  try {
    const { range } = parseRange(req.query);
    const summary = await computeRevenueSummary(range);
    res.json(summary);
  } catch (err: any) {
    res.status(err.status ?? 500).json(err.body ?? { error: "internal_error" });
  }
});

// View 2: bucketed breakdown for the same range.
// e.g. GET /metrics/revenue/breakdown?start=2026-07-01&end=2026-08-01&granularity=week
metricsRouter.get("/metrics/revenue/breakdown", async (req, res) => {
  try {
    const { range, granularity } = parseRange(req.query);
    const breakdown = await computeRevenueBreakdown(range, granularity);
    res.json({ granularity, buckets: breakdown });
  } catch (err: any) {
    res.status(err.status ?? 500).json(err.body ?? { error: "internal_error" });
  }
});

// Runtime canary endpoint: proves, on demand, that the two views above
// still agree. Hit this in the demo video as the "something would catch
// it" evidence, and/or wire it into a health check / CI smoke test.
metricsRouter.get("/metrics/revenue/consistency-check", async (req, res) => {
  try {
    const { range, granularity } = parseRange(req.query);
    const result = await checkSummaryMatchesBreakdown(range, granularity);
    res.status(result.consistent ? 200 : 500).json(result);
  } catch (err: any) {
    res.status(err.status ?? 500).json(err.body ?? { error: "internal_error" });
  }
});
