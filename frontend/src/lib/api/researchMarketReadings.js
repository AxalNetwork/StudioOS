/**
 * D7651 (#7651) — the Eadwyn summary of one market reading (`GET /api/research/market-readings/:uid/summary`, routes/research_client_prep.ts), and of all of them (`GET /api/research/market-readings/summary`, part 2).
 *
 * The rest of the market-readings client stays in `api.js` (`api.research.marketReading*`);
 * this module holds only the method added after the hub froze (D5615).
 *
 * `summary(uid)` → `{ summary }`: the stored reading's metric, scope, range
 * (`{ status: 'recorded', low_cents, high_cents, low_usd: '99.50', high_usd }`
 * or `{ status: 'not_recorded', reason }`), comparable count, run date,
 * catalog price (`recorded` with cents and two-decimal `usd`, `not_recorded`,
 * or `not_applicable` without a service line) and the line as drawn. No model
 * is called. An investor-only account gets 403 `readings_hidden_for_investors`;
 * a reading not on the caller's list is 404 `not_found`.
 *
 * `all()` → `{ summary }` (D7651 part 2): `readings` (how many the caller has
 * stored), `lines` (one `summary(uid)` shape per row of the readings card,
 * newest first, each with `age_days` and `age`), `age` (`current`, `ageing`,
 * `stale`, `undated` counts over the lines), `newest_ran_at` and `basis:
 * 'stored_readings'`. No model is called. An investor-only account gets 403
 * `readings_hidden_for_investors`.
 */
import { request } from '../api.js';

export const researchMarketReadingsApi = {
  summary: (uid) => request(`/research/market-readings/${encodeURIComponent(uid)}/summary`),
  all: () => request('/research/market-readings/summary'),
};
