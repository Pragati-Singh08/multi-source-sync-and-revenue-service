import { Router } from "express";
import { runSync } from "../sync/orchestrator";
import { claimWebhookEvent, upsertSyncRecord } from "../sync/idempotency";
import { prisma } from "../lib/prisma";

export const syncRouter = Router();

// Manually trigger a sync run across all 3 sources. In production this is
// also what a cron/scheduled Render job calls on an interval.
syncRouter.post("/sync/run", async (_req, res) => {
  const result = await runSync();
  res.json(result);
});

syncRouter.get("/sync/runs", async (_req, res) => {
  const runs = await prisma.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 });
  res.json(runs);
});

syncRouter.get("/sync/records", async (req, res) => {
  const { entityType } = req.query;
  const records = await prisma.syncRecord.findMany({
    where: entityType ? { entityType: String(entityType) } : undefined,
    orderBy: { sourceUpdatedAt: "desc" },
    take: 100,
  });
  res.json(records);
});

// Generic webhook receiver used to demonstrate/prove idempotency: fire the
// same payload at this endpoint twice (or a thousand times) and exactly
// one SyncRecord row results.
//
// Expected body: { sourceSystem, eventId, entityType, externalId, payload }
syncRouter.post("/webhooks/:sourceSystem", async (req, res) => {
  const { sourceSystem } = req.params;
  const { eventId, entityType, externalId, payload } = req.body ?? {};

  if (!eventId || !entityType || !externalId) {
    return res.status(400).json({ error: "eventId, entityType, externalId are required" });
  }

  const isNewDelivery = await claimWebhookEvent(sourceSystem, eventId);
  if (!isNewDelivery) {
    // We've already processed this exact delivery. Returning 200 here (not
    // an error) matters: providers retry on non-2xx, and we don't want to
    // manufacture a retry storm just because we're correctly no-opping.
    return res.status(200).json({ status: "duplicate_ignored", eventId });
  }

  const record = await upsertSyncRecord(sourceSystem, {
    entityType,
    externalId,
    sourceUpdatedAt: new Date(),
    normalized: payload ?? {},
    raw: payload ?? {},
  });

  await prisma.webhookEvent.update({
    where: { sourceSystem_eventId: { sourceSystem, eventId } },
    data: { processedAt: new Date() },
  });

  res.status(200).json({ status: "processed", record });
});
