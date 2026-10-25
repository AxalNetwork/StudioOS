// D990 (#2801) — Partner profiles part 1: HQ's list (search, filters, sort and
// pages, with totals over the filtered set), the counts for the tiles and the
// weekly series, and one profile by its reference (`pp_…`), never by email.
// Worker: routes/admin_partner_profiles.ts (/api/admin/partner-profiles),
// Admin and Super Admin; each list and profile read is logged by reference.
// D993 (#2804) — part 4: the first-agreement options with their readiness,
// each row's envelope state (on `rows[].envelope` and the profile's `listed`),
// and Unbind, the Super Admin's one extra control (a recent step-up and a
// reason; logged in Governance).
import { request } from '../api.js';

const BASE = '/admin/partner-profiles';

/** A query string from the set values only. */
const query = (params = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const partnerProfilesApi = {
  /**
   * `{ rows, totals, page, page_size, sort, options }`. Params: q, status
   * (draft | pending | verified | rejected | not_recorded), source (invitation |
   * chat | eadwyn | none), category, founder_track, entity_type, agreement,
   * has_account (yes | no), identity, captured_from, captured_to (YYYY-MM-DD),
   * sort (waiting | newest | name), page, page_size.
   */
  list: (params) => request(`${BASE}${query(params)}`),
  /** `{ waiting, verified_30d, envelopes_out, weekly }`, each with `available` and `reason`. */
  counts: () => request(`${BASE}/counts`),
  /** One profile by reference, `ein` masked, with the list's derived fields on `listed`. */
  get: (ref) => request(`${BASE}/${encodeURIComponent(ref)}`),
  /** `{ groups: [{ label, options: [{ value, label, ready, readiness, source }] }] }`. */
  agreements: () => request(`${BASE}/agreements`),
  /** Free a profile whose address now belongs to another account. Super Admin; `reason` is 10 to 500 characters. */
  unbind: (ref, reason) => request(`${BASE}/${encodeURIComponent(ref)}/unbind`, { method: 'POST', body: JSON.stringify({ reason }) }),
};
