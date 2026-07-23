import Stripe from "stripe";
import { FetchResult, NormalizedInput, SourceAdapter, StaleCursorError } from "../types";
import { stripeFixture } from "../../fixtures/stripe.fixture";

function normalizePayment(raw: any): NormalizedInput {
  return {
    entityType: "payment",
    externalId: raw.id,
    sourceUpdatedAt: new Date((raw.created ?? Date.now() / 1000) * 1000),
    normalized: {
      displayName: raw.description ?? raw.id,
      amountCents: raw.amount,
      currency: raw.currency,
      status: raw.status, // kept raw here; canonicalization happens in metrics/statusMap
      customerEmail: raw.receipt_email ?? null,
    },
    raw,
  };
}

function getClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

export const stripeAdapter: SourceAdapter = {
  sourceSystem: "stripe",

  async fetchFull(): Promise<FetchResult> {
    const client = getClient();
    if (!client) {
      return {
        records: stripeFixture.map(normalizePayment),
        nextCursor: String(Math.floor(Date.now() / 1000)),
        mode: "full",
      };
    }

    const charges = await client.charges.list({ limit: 100 });
    return {
      records: charges.data.map(normalizePayment),
      nextCursor: String(Math.floor(Date.now() / 1000)),
      mode: "full",
    };
  },

  async fetchIncremental(cursor: string): Promise<FetchResult> {
    const client = getClient();
    if (!client) {
      return {
        records: stripeFixture.map(normalizePayment),
        nextCursor: String(Math.floor(Date.now() / 1000)),
        mode: "incremental",
      };
    }

    try {
      // Stripe list endpoints don't take an arbitrary "since" filter
      // directly on `charges.list`, but `created[gte]` gives us the same
      // incremental semantics. A real production build would prefer Stripe
      // Events (`/v1/events?created[gte]=`) for a true changelog, which is
      // what the code below models.
      const gte = Number(cursor);
      if (!Number.isFinite(gte)) {
        // A garbage/non-numeric cursor is the equivalent of Stripe
        // rejecting it — treat it the same as a stale cursor.
        throw new StaleCursorError("stripe");
      }

      const events = await client.events.list({
        created: { gte },
        types: ["charge.succeeded", "charge.updated", "charge.failed"],
        limit: 100,
      });

      const records = events.data.map((e) => normalizePayment(e.data.object as any));
      return {
        records,
        nextCursor: String(Math.floor(Date.now() / 1000)),
        mode: "incremental",
      };
    } catch (err: any) {
      if (err instanceof StaleCursorError) throw err;
      // Stripe uses 410 for de-listed/expired resources on some endpoints,
      // and a generic StripeInvalidRequestError for a malformed cursor.
      if (err?.statusCode === 410 || err?.type === "StripeInvalidRequestError") {
        throw new StaleCursorError("stripe", err);
      }
      throw err;
    }
  },
};
