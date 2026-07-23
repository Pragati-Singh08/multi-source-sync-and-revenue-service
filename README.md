
# Sync Pipeline + Drift-Proof Revenue Metric

Backend-only. No UI — everything below is exercised with `curl`/Postman or `npm test`.

## What's here

- **Problem 1** — a sync pipeline that pulls from HubSpot (CRM), Stripe (payments), and Google
  Calendar (events), normalizes all three into one schema, writes idempotently, falls back to a
  full backfill when a cursor goes stale, and keeps running when one source fails.
- **Problem 2** — a single revenue metric (allow-list based) exposed through a summary endpoint
  and a breakdown endpoint that are structurally guaranteed to agree, plus a runtime consistency
  check.

## Stack

Node.js, TypeScript, Express, Prisma, PostgreSQL (Supabase free tier). No framework magic —
plain adapters + one orchestrator + one query per metric, on purpose (see Tradeoffs).

## Running locally

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL at minimum
npx prisma generate
npx prisma migrate dev --name init
npm run seed                # loads the status allow-list + sample transactions (Problem 2)
npm run dev                 # http://localhost:3000
```

Every external source adapter (`src/sync/sources/*.ts`) checks for its own credentials at
call time. **If `HUBSPOT_TOKEN` / `STRIPE_SECRET_KEY` / `GOOGLE_CALENDAR_API_KEY` are unset, that
adapter runs against a small fixture in `src/fixtures/` instead of the live API.** This means the
whole pipeline is runnable and demoable with zero external accounts, and swapping in real
credentials later changes zero downstream code — the adapter is the only thing that changes.

To run against the real accounts:
1. **HubSpot**: developers.hubspot.com → free developer account → a test portal is created for
   you → Settings → Integrations → Private Apps → create one with `crm.objects.contacts.read` →
   copy the token into `HUBSPOT_TOKEN`. Add 2-3 contacts by hand in the portal UI.
2. **Stripe**: dashboard.stripe.com → toggle **Test mode** → Developers → API keys → copy the
   secret key into `STRIPE_SECRET_KEY`. Create 2-3 charges with the test card `4242 4242 4242 4242`.
3. **Google Calendar**: console.cloud.google.com → new project → enable "Google Calendar API" →
   Credentials → API key → `GOOGLE_CALENDAR_API_KEY`. Then in Google Calendar, create a calendar,
   add 2-3 events, share it publicly (or with the service account), and copy its Calendar ID from
   Settings → Integrate calendar → into `GOOGLE_CALENDAR_ID`.
4. **Supabase**: supabase.com → new project (free tier) → Settings → Database → connection string
   (URI, port 5432 or the pooled 6543 if you're on a serverless host) → `DATABASE_URL`.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/sync/run` | Trigger a sync across all 3 sources now |
| GET | `/sync/runs` | Last 20 sync run outcomes (status, per-source results) |
| GET | `/sync/records?entityType=contact\|payment\|event` | Browse normalized records |
| POST | `/webhooks/:sourceSystem` | Inbound webhook receiver (idempotent) |
| GET | `/metrics/revenue/summary?start=&end=` | Total revenue collected in range |
| GET | `/metrics/revenue/breakdown?start=&end=&granularity=day\|week` | Same range, bucketed |
| GET | `/metrics/revenue/consistency-check?start=&end=` | Asserts the two above agree |

### Proving idempotency by hand

```bash
curl -X POST localhost:3000/webhooks/stripe \
  -H "Content-Type: application/json" \
  -d '{"eventId":"evt_1","entityType":"payment","externalId":"ch_demo_1","payload":{"amount":500}}'

# fire the exact same delivery again
curl -X POST localhost:3000/webhooks/stripe \
  -H "Content-Type: application/json" \
  -d '{"eventId":"evt_1","entityType":"payment","externalId":"ch_demo_1","payload":{"amount":500}}'
# -> {"status":"duplicate_ignored","eventId":"evt_1"}

curl "localhost:3000/sync/records?entityType=payment"
# exactly one ch_demo_1 row, regardless of how many times you re-fire the webhook
```

### Proving the stale-cursor fallback

Set a garbage cursor and re-run sync — the source falls back to a full fetch instead of
crashing or dropping data:

```bash
# after at least one successful run has stored a real cursor, corrupt it
# (this is what the sandbox test in test/ does at the adapter level instead
#  of touching the DB directly — see StaleCursorError handling in orchestrator.ts)
curl -X POST localhost:3000/sync/run
```

`src/sync/sources/googleCalendar.ts` models Google's real, documented behavior here: an
expired/invalid `syncToken` comes back as HTTP 410 with `fullSyncRequired`, and the adapter
throws `StaleCursorError`, which the orchestrator (`src/sync/orchestrator.ts`) specifically
catches to trigger `fetchFull()` instead of surfacing a crash.

### Proving one source failing doesn't wedge the others

Temporarily set `STRIPE_SECRET_KEY` to an invalid value and hit `POST /sync/run` — check
`GET /sync/runs`: status will be `"partial"`, with an `error` field under `stripe` and normal
`fetched`/`upserted` counts under `hubspot` and `google_calendar`. The orchestrator wraps each
source's `runSource()` call individually and never lets one throw stop the loop.

### Tests

```bash
npm test
```

- `test/idempotency.test.ts` — re-running the same upsert twice yields exactly one row; the
  same webhook `eventId` is only claimed once.
- `test/consistency.test.ts` — summary total always equals the sum of the breakdown buckets for
  the same range, and an unmapped status (however large) never leaks into revenue.

## Architecture notes

**Problem 1 — one normalized schema, one write path.**
`SyncRecord` is a single table for contacts/payments/events with a common envelope
(`sourceSystem`, `entityType`, `externalId`, `normalized`, `raw`, `sourceUpdatedAt`). Each
adapter (`src/sync/sources/*.ts`) is responsible for translating its vendor's field names into
that envelope — HubSpot's `firstname`/`lastname`/`lastmodifieddate` and Stripe's own shape both
resolve to the same `normalized.displayName`, for example. `raw` keeps the untouched vendor
payload for audit/debug so nothing is lost in translation.

Idempotency isn't a "check if it exists, then insert" convention that someone can forget to
follow — it's a Postgres unique constraint (`@@unique([sourceSystem, externalId])`) plus a single
`upsertSyncRecord()` function (`src/sync/idempotency.ts`) that every write path (scheduled sync,
manual trigger, webhook) is required to go through. There's no second insert path to drift out of
sync with it.

Stale-cursor handling is a typed error (`StaleCursorError`), not a status-code string check
scattered through the orchestrator. Each adapter is responsible for recognizing its own vendor's
version of "this cursor is dead" (Google: 410 `fullSyncRequired`; HubSpot: 401/400 on a bad
`lastmodifieddate` filter; Stripe: a non-numeric `created[gte]` cursor) and throwing that one
error type. The orchestrator only needs to know one thing: catch `StaleCursorError`, fall back to
`fetchFull()`. Any other error propagates up to `runSync()`, which isolates it to that source
only and keeps going.

**Problem 2 — an allow-list, and one query two views share.**
`StatusMapping` is the allow-list: `(sourceSystem, rawStatus) -> canonicalStatus`. A raw status
that isn't in this table resolves to `"unmapped"` at ingest time and is excluded from revenue by
construction — a brand-new status from a brand-new source can't silently start counting as
revenue, because there is no path from "unrecognized" to "collected" without a human adding a row.
An exclusion list can't offer this guarantee: it has to know the full universe of "not collected"
values in advance, and anything it hasn't seen yet defaults to counting.

`computeRevenueSummary()` and `computeRevenueBreakdown()` (`src/metrics/revenueService.ts`) both
call the same private `getCollectedTransactions()` — one query, one filter
(`canonicalStatus = "collected" AND occurredAt in range`). The breakdown just buckets that same
result set by day/week instead of summing it flat. There's structurally nothing else for a second
implementation to disagree with, which is stronger than "we wrote a test that happens to pass
today." `checkSummaryMatchesBreakdown()` is a runtime canary on top of that: if someone later adds
a second revenue computation elsewhere in the codebase (a cached column, a raw SQL report query)
that quietly diverges, this endpoint (and the Jest test wrapping it) will fail the moment the two
disagree, not just at review time.

## Tradeoffs / what I'd do differently with more time

- **Cursor storage is a single opaque string per source.** Real HubSpot search filters, Stripe
  event cursors, and Google `syncToken`s all have slightly different semantics (timestamp vs.
  opaque token vs. event-list pagination). I unified them behind one `string | null` field to
  keep the orchestrator source-agnostic; a production system might want a `Json` cursor field
  per source to carry richer pagination state.
- **Webhook signature verification is stubbed out.** `POST /webhooks/:sourceSystem` trusts the
  body as-is. A real deployment needs per-provider signature verification (Stripe's
  `stripe-signature` header, HubSpot's `X-HubSpot-Signature`) before touching the dedup table.
- **Invoicer is synthetic.** Free-tier access realistically gives you one live payments
  processor, not two systems with genuinely different status vocabularies. I modeled a second
  source (`src/fixtures/invoicer.fixture.ts`) with different field names and status words
  (`paid`/`void`/`overdue` vs. Stripe's `succeeded`/`failed`) specifically so the allow-list has
  more than one vocabulary to reconcile, including one deliberately unmapped status
  (`disputed_pending_review`) to prove it's excluded.
- **No pagination handling in adapters.** HubSpot/Stripe/Calendar all page past 100-250 results;
  the adapters fetch a single page. Production code would loop `after`/`starting_after`/
  `pageToken` until exhausted.
- **Retry/backoff is not implemented.** A failed source is recorded and skipped for this run,
  not automatically retried with backoff before the next scheduled run picks it up again.

## Sources & references

- HubSpot CRM API — contacts endpoint & search filters: developers.hubspot.com/docs/api/crm/contacts
- Stripe API — charges & events list, test mode & test cards: stripe.com/docs/api, stripe.com/docs/testing
- Google Calendar API — `events.list`, `syncToken`, and the documented 410 `fullSyncRequired`
  behavior on an expired sync token: developers.google.com/calendar/api/v3/reference/events/list
- Prisma — schema design, `upsert`, unique constraints: prisma.io/docs
- Supabase — free Postgres project & connection strings: supabase.com/docs/guides/database
- Render — web service + cron job deployment from a `render.yaml`: render.com/docs/blueprint-spec


=======
# SYNC_ASSIGNMENT
>>>>>>> 86812d1e04f8b5571bb71f5004a87a8f455400d8
