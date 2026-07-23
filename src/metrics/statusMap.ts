// The allow-list. This is intentionally the ONLY place in the codebase
// that says which raw vendor statuses count as money actually collected.
// Adding a new source system means adding rows here — nothing else changes.
//
// Why an allow-list and not an exclusion list: if Stripe (or a brand new
// source) introduces a new status tomorrow that we've never seen — say
// "disputed_pending_review" — an exclusion list of "not collected" values
// would not know to exclude it, so it would silently count as revenue. An
// allow-list means an unrecognized status maps to "unmapped" and is
// excluded by construction until a human deliberately adds it here.
export const CANONICAL_STATUSES = [
  "collected",
  "pending",
  "failed",
  "voided",
  "refunded",
  "unmapped",
] as const;

export type CanonicalStatus = (typeof CANONICAL_STATUSES)[number];

// Only "collected" ever counts toward revenue. Defined once, imported
// everywhere that needs to filter for "money that actually landed."
export const COLLECTED_STATUS: CanonicalStatus = "collected";

// Seed data for the StatusMapping table (see prisma/schema.prisma). This is
// the allow-list expressed per source system, in each source's own words.
export const DEFAULT_STATUS_MAPPINGS: Array<{
  sourceSystem: string;
  rawStatus: string;
  canonicalStatus: CanonicalStatus;
}> = [
  // Stripe vocabulary
  { sourceSystem: "stripe", rawStatus: "succeeded", canonicalStatus: "collected" },
  { sourceSystem: "stripe", rawStatus: "pending", canonicalStatus: "pending" },
  { sourceSystem: "stripe", rawStatus: "failed", canonicalStatus: "failed" },

  // Invoicer vocabulary — deliberately different words for the same
  // concepts, which is the whole point of this problem.
  { sourceSystem: "invoicer", rawStatus: "paid", canonicalStatus: "collected" },
  { sourceSystem: "invoicer", rawStatus: "overdue", canonicalStatus: "pending" },
  { sourceSystem: "invoicer", rawStatus: "void", canonicalStatus: "voided" },
  { sourceSystem: "invoicer", rawStatus: "refunded", canonicalStatus: "refunded" },
  // Note: "disputed_pending_review" from the invoicer fixture is
  // deliberately NOT listed here. It will resolve to "unmapped" at ingest
  // time (see resolveCanonicalStatus below) and will never count as
  // revenue until someone reviews it and adds a row above.
];

// Called at ingest time (see seed/ingestTransactions.ts) to resolve a raw
// vendor status into a canonical one, looking it up against the DB-backed
// StatusMapping table (which is seeded from DEFAULT_STATUS_MAPPINGS, but
// can be extended at runtime without a deploy — e.g. an ops engineer maps
// a newly-discovered status without touching code).
export function resolveFromMappingList(
  mappings: Array<{ sourceSystem: string; rawStatus: string; canonicalStatus: string }>,
  sourceSystem: string,
  rawStatus: string
): CanonicalStatus {
  const hit = mappings.find(
    (m) => m.sourceSystem === sourceSystem && m.rawStatus === rawStatus
  );
  return (hit?.canonicalStatus as CanonicalStatus) ?? "unmapped";
}
