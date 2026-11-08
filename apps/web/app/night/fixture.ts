// The Night demo uses ShopNorth and baseline numbers from the repo's Dana fake facts.
export type MetricSample = {
  time: string;
  errorRate: number;
  ordersPerMinute: number;
};

export const HISTORY: readonly MetricSample[] = [
  { time: "01:47", errorRate: 0.4, ordersPerMinute: 420 },
  { time: "01:50", errorRate: 12.6, ordersPerMinute: 371 },
  { time: "01:55", errorRate: 27.4, ordersPerMinute: 312 },
  { time: "02:04", errorRate: 31.2, ordersPerMinute: 290 },
];

export const RECOVERY = [
  { delay: 2000, time: "02:04:02", errorRate: 18.3, ordersPerMinute: 344 },
  { delay: 3000, time: "02:04:05", errorRate: 4.7, ordersPerMinute: 397 },
  { delay: 4000, time: "02:04:09", errorRate: 0.4, ordersPerMinute: 420 },
] as const;

export const DEPLOYS = [
  { version: "v2.14.0", time: "01:47", title: "Add loyalty tier discounts" },
  { version: "v2.13.9", time: "Yesterday, 16:20", title: "Fix cart rounding" },
] as const;

export const LOGS = [
  {
    id: "checkout-500",
    time: "02:04:01",
    level: "error",
    summary: "POST /checkout 500 · guest checkout",
    detail: "KeyError: 'tier'\n  at checkout/pricing.py:18 in loyalty_percent\n  customer.profile[\"tier\"]",
  },
  {
    id: "checkout-200",
    time: "02:03:58",
    level: "info",
    summary: "POST /checkout 200 · gold member",
    detail: "Member checkout succeeded. Total $72.00.",
  },
  {
    id: "checkout-first-500",
    time: "01:50:02",
    level: "error",
    summary: "POST /checkout 500 · guest checkout",
    detail: "KeyError: 'tier'\n  at checkout/pricing.py:18 in loyalty_percent",
  },
] as const;

export const RECOVERY_LOG = {
  id: "checkout-recovered",
  time: "02:04:09",
  level: "info",
  summary: "Checkout metrics returned to baseline",
  detail: "Error rate 0.4%. Successful orders 420/min. Loyalty discounts disabled.",
} as const;

export const BRIEFING = "Checkout is failing for about a third of shoppers during the flash sale. Start by checking when the errors rose and what changed around that time.";

export function scriptedReply(text: string) {
  if (/deploy|releas|chang/i.test(text)) return "A release went out at 01:47. Compare that time with the first checkout errors.";
  return "About one in three checkouts is failing. Use the dashboard and logs to narrow down who is affected.";
}
