// D4357 (#4357), extended by D6707 (#6707) — the Incorporate quote, line by line, for the review step.
// Worker: routes/legal_incorporation_quote.ts over services/incorporationQuote.ts.
//   GET /api/legal/incorporation/itemised-quote?jurisdiction_id=
//       → { jurisdiction_id, label,
//           lines: [{ key, label, amount_cents | null, currency, interval, optional, paid, source, source_url, checked_on,
//                     payee: 'axal' | 'partner' | 'government', payee_name, collected_by: 'axal' | 'partner' | 'government',
//                     timing: 'at_order' | 'at_filing' | 'yearly' | 'monthly', billed_by }],
//           total: { amount_cents | null, currency, complete, unknown },
//           totals: [{ amount_cents | null, currency, complete, unknown }],   one per currency, never summed across
//           charge: { currency, amount_cents | null, lines } }               what Axal VC collects with the order
//   POST /api/legal/incorporation/cases/:uid/itemised-quote
//       → { case_uid, quote_uid, form_key, ...the same quote }, snapshotted on the case.
// A fee that is not known is null, never 0. A partner line the partner collects names it in `billed_by`
// ("billed by [Partner]"); a partner's cost is never returned.
import { request } from '../api.js';

export const incorporationQuoteApi = {
  itemised: (jurisdictionId) => request(`/legal/incorporation/itemised-quote?jurisdiction_id=${encodeURIComponent(jurisdictionId)}`),
  quoteCase: (caseUid) => request(`/legal/incorporation/cases/${encodeURIComponent(caseUid)}/itemised-quote`, { method: 'POST' }),
};
