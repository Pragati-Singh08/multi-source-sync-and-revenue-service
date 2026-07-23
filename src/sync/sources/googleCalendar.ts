import { google } from "googleapis";
import { FetchResult, NormalizedInput, SourceAdapter, StaleCursorError } from "../types";
import { calendarFixture } from "../../fixtures/calendar.fixture";

function normalizeEvent(raw: any): NormalizedInput {
  return {
    entityType: "event",
    externalId: raw.id,
    sourceUpdatedAt: new Date(raw.updated ?? Date.now()),
    normalized: {
      displayName: raw.summary ?? "(no title)",
      startsAt: raw.start?.dateTime ?? raw.start?.date ?? null,
      endsAt: raw.end?.dateTime ?? raw.end?.date ?? null,
      location: raw.location ?? null,
    },
    raw,
  };
}

function getClient() {
  const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!apiKey || !calendarId) return null;
  return { calendar: google.calendar({ version: "v3", auth: apiKey }), calendarId };
}

export const googleCalendarAdapter: SourceAdapter = {
  sourceSystem: "google_calendar",

  async fetchFull(): Promise<FetchResult> {
    const client = getClient();
    if (!client) {
      return {
        records: calendarFixture.map(normalizeEvent),
        nextCursor: null, // Calendar's real cursor is a syncToken, minted only after a real list call
        mode: "full",
      };
    }

    const res = await client.calendar.events.list({
      calendarId: client.calendarId,
      singleEvents: true,
      maxResults: 250,
    });

    return {
      records: (res.data.items ?? []).map(normalizeEvent),
      nextCursor: res.data.nextSyncToken ?? null,
      mode: "full",
    };
  },

  async fetchIncremental(cursor: string): Promise<FetchResult> {
    const client = getClient();
    if (!client) {
      return {
        records: calendarFixture.map(normalizeEvent),
        nextCursor: cursor,
        mode: "incremental",
      };
    }

    try {
      const res = await client.calendar.events.list({
        calendarId: client.calendarId,
        syncToken: cursor,
        singleEvents: true,
      });

      return {
        records: (res.data.items ?? []).map(normalizeEvent),
        nextCursor: res.data.nextSyncToken ?? null,
        mode: "incremental",
      };
    } catch (err: any) {
      // Google Calendar's documented behavior: an expired/invalid syncToken
      // comes back as HTTP 410 Gone with reason "fullSyncRequired". This is
      // the textbook case the assignment describes.
      if (err?.code === 410 || err?.response?.status === 410) {
        throw new StaleCursorError("google_calendar", err);
      }
      throw err;
    }
  },
};
