// D4357 (#4357) — the Incorporate quote, line by line, for the review step.
// Worker: routes/legal_incorporation_quote.ts over services/incorporationQuote.ts.
//   GET /api/legal/incorporation/itemised-quote?jurisdiction_id=
//       → { jurisdiction_id, label, lines: [{ key, label, amount_cents | null, currency, interval, optional,
//            paid, source, source_url, checked_on }], total: { amount_cents | null, currency, complete, unknown } }
// A fee that is not known is null, never 0.
import { request } from '../api.js';

export const incorporationQuoteApi = {
  itemised: (jurisdictionId) => request(`/legal/incorporation/itemised-quote?jurisdiction_id=${encodeURIComponent(jurisdictionId)}`),
};
