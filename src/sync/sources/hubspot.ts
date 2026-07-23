import axios from "axios";
import { FetchResult, NormalizedInput, SourceAdapter, StaleCursorError } from "../types";
import { hubspotFixture } from "../../fixtures/hubspot.fixture";

const HUBSPOT_BASE = "https://api.hubapi.com";

// HubSpot names its fields "firstname"/"lastname"/"email"/"lastmodifieddate".
// We map that into the common envelope so the rest of the pipeline never
// has to know HubSpot's vocabulary exists.
function normalizeContact(raw: any): NormalizedInput {
  const p = raw.properties ?? {};
  return {
    entityType: "contact",
    externalId: String(raw.id),
    sourceUpdatedAt: new Date(p.lastmodifieddate ?? raw.updatedAt ?? Date.now()),
    normalized: {
      displayName: [p.firstname, p.lastname].filter(Boolean).join(" ") || p.email || raw.id,
      email: p.email ?? null,
      company: p.company ?? null,
    },
    raw,
  };
}

export const hubspotAdapter: SourceAdapter = {
  sourceSystem: "hubspot",

  async fetchFull(): Promise<FetchResult> {
    const token = process.env.HUBSPOT_TOKEN;
    if (!token) {
      // No live credentials configured — run against the seeded fixture so
      // the pipeline is fully demoable before you've created the HubSpot
      // dev account. Swap this for the real call below once HUBSPOT_TOKEN
      // is set.
      return {
        records: hubspotFixture.map(normalizeContact),
        nextCursor: new Date().toISOString(),
        mode: "full",
      };
    }

    const res = await axios.get(`${HUBSPOT_BASE}/crm/v3/objects/contacts`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { properties: "firstname,lastname,email,company,lastmodifieddate", limit: 100 },
    });

    return {
      records: res.data.results.map(normalizeContact),
      nextCursor: new Date().toISOString(),
      mode: "full",
    };
  },

  async fetchIncremental(cursor: string): Promise<FetchResult> {
    const token = process.env.HUBSPOT_TOKEN;
    if (!token) {
      // Fixture mode: pretend everything since the cursor changed (fixture
      // is small and static) — demonstrates the code path without needing
      // a live account.
      return {
        records: hubspotFixture.map(normalizeContact),
        nextCursor: new Date().toISOString(),
        mode: "incremental",
      };
    }

    try {
      // HubSpot's real incremental mechanism is the Search API filtered on
      // lastmodifieddate > cursor (contacts don't have a first-class
      // "since" cursor endpoint on the free tier the way deals/CRM v3
      // search does).
      const res = await axios.post(
        `${HUBSPOT_BASE}/crm/v3/objects/contacts/search`,
        {
          filterGroups: [
            {
              filters: [
                { propertyName: "lastmodifieddate", operator: "GT", value: cursor },
              ],
            },
          ],
          properties: ["firstname", "lastname", "email", "company", "lastmodifieddate"],
          limit: 100,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      return {
        records: res.data.results.map(normalizeContact),
        nextCursor: new Date().toISOString(),
        mode: "incremental",
      };
    } catch (err: any) {
      // HubSpot returns 401 with a specific category for an expired/revoked
      // token, and search filters on a garbage cursor value come back as
      // 400 VALIDATION_ERROR. Either way, we can't trust this cursor —
      // signal the orchestrator to fall back to a full backfill instead of
      // silently dropping the sync.
      const status = err?.response?.status;
      if (status === 410 || status === 401 || status === 400) {
        throw new StaleCursorError("hubspot", err);
      }
      throw err;
    }
  },
};
