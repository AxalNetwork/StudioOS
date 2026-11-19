// D6157 (#6157) — the Closing zone's per-deal rows in one read (DE08 A). Worker:
// routes/deal_closing_overview.ts, at GET /api/deals/closing-overview.
//
// Only the funded deals the caller may read. Each part (checklist, envelopes,
// conditions, transfer, closing) is `{state: 'recorded', ...}`, or
// `{state: 'unrecorded' | 'unreadable', reason}`; a part that could not be
// read is never a zero. `closing.own_lines` are the caller's own lines only.
import { request } from '../api.js';

export const dealClosingOverviewApi = {
  /**
   * {deals: [{id, project_id, name, currency, capital_committed,
   *   checklist: {done, total}, envelopes: {executed, total, signatures_outstanding, uncounted},
   *   conditions: {open, held}, transfer: {recorded, count},
   *   closing: {uid, status, reach, own_lines: [{uid, status}]}}]}
   */
  read: () => request('/deals/closing-overview'),
};
