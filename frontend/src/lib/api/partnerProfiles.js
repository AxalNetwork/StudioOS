// D990 (#2801) — Partner profiles part 1: HQ's list (search, filters, sort and
// pages, with totals over the filtered set), the counts for the tiles and the
// weekly series, and one profile by its reference (`pp_…`), never by email.
// Worker: routes/admin_partner_profiles.ts (/api/admin/partner-profiles),
// Admin and Super Admin; each list and profile read is logged by reference.
// D991 (#2802) — part 2: a profile's history, and Reopen for review.
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
   * reviewed_by (an admin's account id | not_recorded), sort (waiting | newest
   * | reviewed | name), page, page_size. Each row carries `reviewed_at`,
   * `reviewed_by` and `changed_after_review_at` (D991).
   */
  list: (params) => request(`${BASE}${query(params)}`),
  /** `{ waiting, verified_30d, envelopes_out, weekly }`, each with `available` and `reason`. */
  counts: () => request(`${BASE}/counts`),
  /** One profile by reference, `ein` masked, with the list's derived fields on `listed`. */
  get: (ref) => request(`${BASE}/${encodeURIComponent(ref)}`),
  /** D991 — `{ items, total, limit, offset }`, newest first: captures by source, and decisions with who made them. */
  history: (ref, params) => request(`${BASE}/${encodeURIComponent(ref)}/history${query(params)}`),
  /** D991 — back in the queue, with an optional `reason`; the verdict stays in the history. */
  reopen: (ref, reason) => request(`${BASE}/${encodeURIComponent(ref)}/reopen`, { method: 'POST', body: JSON.stringify({ reason: reason || null }) }),
};
