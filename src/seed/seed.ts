import { prisma } from "../lib/prisma";
import { DEFAULT_STATUS_MAPPINGS, resolveFromMappingList } from "../metrics/statusMap";
import { stripeFixture } from "../fixtures/stripe.fixture";
import { invoicerFixture } from "../fixtures/invoicer.fixture";

async function main() {
  console.log("Seeding StatusMapping allow-list...");
  for (const m of DEFAULT_STATUS_MAPPINGS) {
    await prisma.statusMapping.upsert({
      where: { sourceSystem_rawStatus: { sourceSystem: m.sourceSystem, rawStatus: m.rawStatus } },
      create: m,
      update: { canonicalStatus: m.canonicalStatus },
    });
  }

  // Load the mapping table fresh (not just DEFAULT_STATUS_MAPPINGS) so this
  // script demonstrates the real ingest-time resolution path — including
  // rawStatus values that were never mapped, which resolve to "unmapped".
  const mappings = await prisma.statusMapping.findMany();

  console.log("Ingesting Stripe transactions...");
  for (const charge of stripeFixture) {
    const canonicalStatus = resolveFromMappingList(mappings, "stripe", charge.status);
    await prisma.transaction.upsert({
      where: { sourceSystem_externalId: { sourceSystem: "stripe", externalId: charge.id } },
      create: {
        sourceSystem: "stripe",
        externalId: charge.id,
        rawStatus: charge.status,
        canonicalStatus,
        amountCents: charge.amount,
        currency: charge.currency,
        occurredAt: new Date(charge.created * 1000),
        raw: charge as any,
      },
      update: { canonicalStatus, rawStatus: charge.status },
    });
  }

  console.log("Ingesting Invoicer transactions...");
  for (const inv of invoicerFixture) {
    const canonicalStatus = resolveFromMappingList(mappings, "invoicer", inv.status);
    await prisma.transaction.upsert({
      where: { sourceSystem_externalId: { sourceSystem: "invoicer", externalId: inv.invoice_id } },
      create: {
        sourceSystem: "invoicer",
        externalId: inv.invoice_id,
        rawStatus: inv.status,
        canonicalStatus,
        amountCents: inv.total_cents,
        currency: inv.currency,
        occurredAt: new Date(inv.paid_at),
        raw: inv as any,
      },
      update: { canonicalStatus, rawStatus: inv.status },
    });
  }

  console.log("Done. Unmapped statuses ingested but excluded from revenue:");
  const unmapped = await prisma.transaction.findMany({ where: { canonicalStatus: "unmapped" } });
  console.table(
    unmapped.map((t: { sourceSystem: string; externalId: string; rawStatus: string }) => ({
      source: t.sourceSystem,
      id: t.externalId,
      rawStatus: t.rawStatus,
    }))
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
