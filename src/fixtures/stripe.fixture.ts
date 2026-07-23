// Shaped like Stripe's real charge objects.
export const stripeFixture = [
  {
    id: "ch_1A1",
    amount: 4999,
    currency: "usd",
    status: "succeeded",
    description: "Plan upgrade - Northwind Retail",
    receipt_email: "asha@example.com",
    created: 1751362800, // 2025-07-01
  },
  {
    id: "ch_1A2",
    amount: 1200,
    currency: "usd",
    status: "failed",
    description: "Add-on seat - Blue Harbor Logistics",
    receipt_email: "devon@example.com",
    created: 1751708400, // 2025-07-05
  },
  {
    id: "ch_1A3",
    amount: 9900,
    currency: "usd",
    status: "succeeded",
    description: "Annual plan - Priya Nair",
    receipt_email: "priya@example.com",
    created: 1752055200, // 2025-07-09
  },
];
