/**
 * What the Offers pages mean by requested, booked, delivered, invoiced, paid
 * and won — one definition each, shared by the catalogue read
 * (`routes/services.ts`), the Visibility read (`routes/partner_offers.ts`) and
 * the AI gather in `routes/research.ts` (#4696).
 *
 * TWO STORES, TWO SETS OF WORDS, AND THEY ARE NOT ADDED TOGETHER.
 *
 *   `service_engagements` is a REQUEST for a catalogue entry (migration 034).
 *   It records the quoted price for new requests (#4680), has no link to an invoice, and the only status
 *   anything writes is `pending` (`POST /services/offerings/:id/engage`). So a
 *   count of its rows is a count of requests; multiplying one by the entry's
 *   CURRENT price states a sale that no one made, and states it again at a
 *   different figure after every reprice. The catalogue therefore serves
 *   COUNTS, with the status each count reads, and a separate sum of known quotes.
 *
 *   `engagements` is accepted work (a quote the founder accepted). Its `price`
 *   was copied from the accepted quote and never follows the catalogue, so it
 *   is a transactional amount and may be summed. A cancelled engagement is not
 *   won work, so it contributes to neither the count nor the value of a
 *   measure labelled Won.
 */

/** Statuses at or beyond each rung of the request ladder; `cancelled` is on none. */
export const BOOKED_STATUSES = ['accepted', 'in_progress', 'delivered', 'reviewed', 'invoiced', 'paid'] as const;
export const DELIVERED_STATUSES = ['delivered', 'reviewed', 'invoiced', 'paid'] as const;
export const INVOICED_STATUSES = ['invoiced', 'paid'] as const;
export const PAID_STATUSES = ['paid'] as const;

const list = (xs: readonly string[]) => xs.map((s) => `'${s}'`).join(', ');

/*
 * THE STATUS LISTS ARE WRITTEN OUT IN THE QUERIES THAT COUNT THEM
 * (`routes/services.ts`, `routes/partner_offers.ts`, `routes/research.ts`),
 * because `check-sql-prepare` refuses text interpolated into a prepared
 * statement. These constants are the definition those queries are written
 * from, and the Offers reconcile test pins each against a fixture.
 */

export interface RequestMeasures {
  requested: number; pending: number; booked: number; delivered: number;
  invoiced: number; paid: number; cancelled: number;
}

export const REQUEST_MEASURE_KEYS: (keyof RequestMeasures)[] = [
  'requested', 'pending', 'booked', 'delivered', 'invoiced', 'paid', 'cancelled',
];

export function requestMeasures(row: Record<string, unknown> | null | undefined): RequestMeasures {
  const n = (k: string) => Number(row?.[k] ?? 0) || 0;
  return {
    requested: n('requested'), pending: n('pending'), booked: n('booked'), delivered: n('delivered'),
    invoiced: n('invoiced'), paid: n('paid'), cancelled: n('cancelled'),
  };
}

/** The catalogue total is the sum of the rows served, never a second query. */
export function sumRequestMeasures(rows: { requests: RequestMeasures }[]): RequestMeasures {
  const out = requestMeasures(null);
  for (const r of rows) for (const k of REQUEST_MEASURE_KEYS) out[k] += r.requests[k];
  return out;
}

/** What each count reads, in the response, so a page cannot relabel it. */
export const REQUEST_MEASURE_BASIS: Record<keyof RequestMeasures, string> = {
  requested: 'Every service request made against the entry, whatever became of it.',
  pending: 'Requests still waiting for the firm: status pending.',
  booked: `Requests whose status is ${list(BOOKED_STATUSES)}: accepted by the firm and not cancelled.`,
  delivered: `Requests whose status is ${list(DELIVERED_STATUSES)}.`,
  invoiced: `Requests whose status is ${list(INVOICED_STATUSES)}.`,
  paid: 'Requests whose status is paid.',
  cancelled: 'Requests whose status is cancelled; they are in requested and in no other count.',
};

export const REQUEST_MEASURE_NOTE =
  'These are counts of service requests by the status each row carries. Quoted amounts are reported separately. '
  + 'No step in the product moves '
  + 'a request past pending yet, so booked, delivered, invoiced and paid read the rows that carry those '
  + 'statuses, which today is none.';

export const REQUEST_VALUE_NOTE =
  'Total quoted USD value from recorded service requests. This does not measure accepted bookings or payments. '
  + 'Requests without a recorded quote are counted separately.';

export function sumQuotedValues(rows: { quoted_total?: number | null; unquoted?: number }[]) {
  let total: number | null = null;
  let missing = 0;
  for (const row of rows) {
    if (row.quoted_total != null) total = (total ?? 0) + row.quoted_total;
    missing += row.unquoted ?? 0;
  }
  return { booked_value_cents: total, requests_without_recorded_amount: missing };
}

export const WON_MEASURE_BASIS = {
  engagement_count: 'Every engagement attributed to the surface, including cancelled ones.',
  won_count: 'Attributed engagements that are not cancelled.',
  won_value: 'The sum of the accepted quote price copied onto each attributed engagement that is not cancelled, in dollars. It is a transactional amount: repricing a catalogue entry does not change it. A cancelled engagement adds nothing.',
  cancelled_count: 'Attributed engagements that were cancelled; they are in engagement_count and in no Won measure.',
  delivered_count: 'Won engagements the firm marked delivered.',
  invoiced_count: 'Won engagements with an invoice that is not void.',
  paid_count: 'Won engagements whose invoice the firm recorded as paid; the platform does not collect the money.',
} as const;
