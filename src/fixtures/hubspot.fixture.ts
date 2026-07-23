// Sample data shaped exactly like HubSpot's real contacts API response,
// so swapping in a live account changes zero downstream code.
export const hubspotFixture = [
  {
    id: "101",
    properties: {
      firstname: "Asha",
      lastname: "Verma",
      email: "asha@example.com",
      company: "Northwind Retail",
      lastmodifieddate: "2026-07-01T10:00:00.000Z",
    },
  },
  {
    id: "102",
    properties: {
      firstname: "Devon",
      lastname: "Clarke",
      email: "devon@example.com",
      company: "Blue Harbor Logistics",
      lastmodifieddate: "2026-07-05T14:30:00.000Z",
    },
  },
  {
    id: "103",
    properties: {
      firstname: "Priya",
      lastname: "Nair",
      email: "priya@example.com",
      company: null,
      lastmodifieddate: "2026-07-10T09:15:00.000Z",
    },
  },
];
