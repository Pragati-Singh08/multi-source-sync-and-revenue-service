import { prisma } from "../lib/prisma";
import { NormalizedInput } from "./types";

// Every write to SyncRecord goes through this one function. It relies on
// the @@unique([sourceSystem, externalId]) constraint in the schema:
// - first time we see (source, externalId) -> INSERT
// - every subsequent time (re-run, re-delivered webhook, overlapping
//   incremental windows) -> UPDATE the same row
// There is no "check if exists, then insert" race condition here because
// Postgres enforces the uniqueness, and upsert is a single atomic
// statement (ON CONFLICT DO UPDATE) rather than two round trips.
export async function upsertSyncRecord(sourceSystem: string, record: NormalizedInput) {
  return prisma.syncRecord.upsert({
    where: {
      sourceSystem_externalId: {
        sourceSystem,
        externalId: record.externalId,
      },
    },
    create: {
      sourceSystem,
      entityType: record.entityType,
      externalId: record.externalId,
      normalized: record.normalized as any,
      raw: record.raw as any,
      sourceUpdatedAt: record.sourceUpdatedAt,
    },
    update: {
      entityType: record.entityType,
      normalized: record.normalized as any,
      raw: record.raw as any,
      sourceUpdatedAt: record.sourceUpdatedAt,
    },
  });
}

// Returns true if this webhook delivery is new (should be processed),
// false if we've already recorded this exact (source, eventId) before.
// This is a belt-and-suspenders layer on top of upsertSyncRecord: the
// upsert alone already makes duplicate deliveries harmless for the DB
// row, but a webhook handler often also needs to avoid re-running
// non-idempotent side effects (sending a notification, firing a follow-up
// job) — so we still want to know "have I truly not seen this before".
export async function claimWebhookEvent(sourceSystem: string, eventId: string): Promise<boolean> {
  try {
    await prisma.webhookEvent.create({
      data: { sourceSystem, eventId },
    });
    return true;
  } catch (err: any) {
    // Unique constraint violation -> we've already processed this delivery.
    if (err?.code === "P2002") return false;
    throw err;
  }
}
