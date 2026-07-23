// A record normalized to the common envelope, ready to be upserted into
// SyncRecord. Every adapter is responsible for producing this shape no
// matter how different the vendor's own field names are.
export interface NormalizedInput {
  entityType: "contact" | "payment" | "event";
  externalId: string;
  sourceUpdatedAt: Date;
  normalized: Record<string, unknown>;
  raw: unknown;
}

export interface FetchResult {
  records: NormalizedInput[];
  // Opaque token to persist for next time. `null` means "this source has
  // no notion of a cursor / we just did a full fetch that resets it."
  nextCursor: string | null;
  mode: "incremental" | "full";
}

// Thrown by an adapter when the incremental cursor it was given is no
// longer valid — this is the case the assignment specifically calls out:
// a 410 Gone, an expired webhook subscription, a revoked sync token, etc.
// The orchestrator catches this specific error type (and only this type)
// to decide "fall back to a full backfill" rather than treating it as a
// generic failure.
export class StaleCursorError extends Error {
  originalError?: unknown;

  constructor(sourceSystem: string, originalError?: unknown) {
    super(`Cursor stale/rejected for source "${sourceSystem}"`);
    this.name = "StaleCursorError";
    this.originalError = originalError;
  }
}

export interface SourceAdapter {
  sourceSystem: string;
  fetchIncremental(cursor: string): Promise<FetchResult>;
  fetchFull(): Promise<FetchResult>;
}
