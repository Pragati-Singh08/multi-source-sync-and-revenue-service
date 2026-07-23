import { prisma } from "../lib/prisma";
import { hubspotAdapter } from "./sources/hubspot";
import { stripeAdapter } from "./sources/stripe";
import { googleCalendarAdapter } from "./sources/googleCalendar";
import { SourceAdapter, StaleCursorError } from "./types";
import { upsertSyncRecord } from "./idempotency";

const ADAPTERS: SourceAdapter[] = [hubspotAdapter, stripeAdapter, googleCalendarAdapter];

interface SourceResult {
  mode: "incremental" | "full" | "skipped";
  fetched: number;
  upserted: number;
  fellBackToFull: boolean;
  error: string | null;
}

// Runs one source end to end: figure out cursor -> incremental or full ->
// upsert every record -> persist new cursor. Any error thrown here is
// caught by the caller (runSync), never by this function — that's what
// keeps one bad source from ever affecting the others.
async function runSource(adapter: SourceAdapter): Promise<SourceResult> {
  const cursorRow = await prisma.syncCursor.findUnique({
    where: { sourceSystem: adapter.sourceSystem },
  });

  let fellBackToFull = false;
  let result;

  if (cursorRow?.cursor) {
    try {
      result = await adapter.fetchIncremental(cursorRow.cursor);
    } catch (err) {
      if (err instanceof StaleCursorError) {
        // The exact case the assignment calls out: cursor is stale/rejected
        // (410, expired token, malformed value). Instead of crashing or
        // silently losing the data that would have come through
        // incrementally, fall back to pulling everything.
        fellBackToFull = true;
        result = await adapter.fetchFull();
      } else {
        throw err;
      }
    }
  } else {
    // No cursor yet at all -> first run for this source -> full backfill.
    result = await adapter.fetchFull();
  }

  for (const record of result.records) {
    await upsertSyncRecord(adapter.sourceSystem, record);
  }

  await prisma.syncCursor.upsert({
    where: { sourceSystem: adapter.sourceSystem },
    create: {
      sourceSystem: adapter.sourceSystem,
      cursor: result.nextCursor,
      lastSyncedAt: new Date(),
      lastFullSyncAt: result.mode === "full" ? new Date() : null,
    },
    update: {
      cursor: result.nextCursor,
      lastSyncedAt: new Date(),
      ...(result.mode === "full" ? { lastFullSyncAt: new Date() } : {}),
    },
  });

  return {
    mode: result.mode,
    fetched: result.records.length,
    upserted: result.records.length,
    fellBackToFull,
    error: null,
  };
}

// Entry point for both the scheduled job and the manual "trigger a sync"
// endpoint. Runs every source, isolates failures per-source, and always
// returns a full picture of what happened rather than throwing on the
// first problem — a down/garbage source degrades that one source's
// results, it does not wedge the whole run.
export async function runSync() {
  const startedAt = new Date();
  const results: Record<string, SourceResult> = {};

  for (const adapter of ADAPTERS) {
    try {
      results[adapter.sourceSystem] = await runSource(adapter);
    } catch (err: any) {
      results[adapter.sourceSystem] = {
        mode: "skipped",
        fetched: 0,
        upserted: 0,
        fellBackToFull: false,
        error: err?.message ?? String(err),
      };
    }
  }

  const outcomes = Object.values(results);
  const anyFailed = outcomes.some((r) => r.error);
  const anySucceeded = outcomes.some((r) => !r.error);
  const status = !anyFailed ? "success" : anySucceeded ? "partial" : "failed";

  await prisma.syncRun.create({
    data: {
      startedAt,
      finishedAt: new Date(),
      status,
      results: results as any,
    },
  });

  return { status, results };
}
