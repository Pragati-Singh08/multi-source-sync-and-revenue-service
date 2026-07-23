import { prisma } from "../src/lib/prisma";
import { upsertSyncRecord, claimWebhookEvent } from "../src/sync/idempotency";

describe("idempotent writes (Problem 1)", () => {
  beforeAll(async () => {
    await prisma.webhookEvent.deleteMany();
    await prisma.syncRecord.deleteMany();
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany();
    await prisma.syncRecord.deleteMany();
    await prisma.$disconnect();
  });

  it("re-running the same upsert twice produces exactly one row", async () => {
    const input = {
      entityType: "contact" as const,
      externalId: "test-contact-idempotency-1",
      sourceUpdatedAt: new Date(),
      normalized: { displayName: "Test User" },
      raw: { id: "test-contact-idempotency-1" },
    };

    await upsertSyncRecord("test_source", input);
    await upsertSyncRecord("test_source", input); // simulate the sync job re-running back-to-back

    const rows = await prisma.syncRecord.findMany({
      where: { sourceSystem: "test_source", externalId: "test-contact-idempotency-1" },
    });

    expect(rows.length).toBe(1);
  });

  it("the same webhook event id firing twice is only claimed once", async () => {
    const first = await claimWebhookEvent("test_source", "evt-duplicate-1");
    const second = await claimWebhookEvent("test_source", "evt-duplicate-1");

    expect(first).toBe(true);
    expect(second).toBe(false); // second delivery is correctly recognized as a duplicate
  });
});
