// A second "finance system" so problem 2 actually has more than one status
// vocabulary to reconcile. Free-tier accounts only give you one real
// payments processor, so this models a second internal system (e.g. an
// invoicing tool) whose statuses are worded completely differently from
// Stripe's: "paid"/"void"/"overdue" instead of "succeeded"/"failed".
export const invoicerFixture = [
  {
    invoice_id: "INV-1001",
    total_cents: 250000,
    currency: "usd",
    status: "paid",
    billed_to: "Northwind Retail",
    paid_at: "2026-07-03T00:00:00Z",
  },
  {
    invoice_id: "INV-1002",
    total_cents: 75000,
    currency: "usd",
    status: "overdue",
    billed_to: "Blue Harbor Logistics",
    paid_at: "2026-07-11T00:00:00Z",
  },
  {
    invoice_id: "INV-1003",
    total_cents: 120000,
    currency: "usd",
    status: "void",
    billed_to: "Priya Nair",
    paid_at: "2026-07-12T00:00:00Z",
  },
  {
    // deliberately unmapped status to prove the allow-list holds
    invoice_id: "INV-1004",
    total_cents: 500000,
    currency: "usd",
    status: "disputed_pending_review",
    billed_to: "Northwind Retail",
    paid_at: "2026-07-13T00:00:00Z",
  },
];
