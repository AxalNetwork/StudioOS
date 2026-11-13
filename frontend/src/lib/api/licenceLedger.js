// #4700 (Licences audit 5/7) — HQ's licence ledger, read a page at a time, and
// one licence's open requests, scoped on the server.
// Worker: routes/admin_licences.ts over services/licenceLedgerReads.ts (Super Admin).
//   GET /api/admin/licences?q=&kind=&status=&limit=&cursor=
//        → { items, total, next_cursor|null, limit, seats_used_available, seats_used_reason }
//   GET /api/admin/licences/summary
//        → { coverage: [{ uid, licence_ref, brand_name, status, territories }],
//            renewals: { items, total, complete }, counts: { total, by_status, by_kind } }
//   GET /api/admin/licences/:uid/requests?limit=&cursor=
//        → { available, items, total, next_cursor|null, branch_code, branch_readable }
//          | { available: false, reason }
import { request } from '../api.js';

const enc = encodeURIComponent;

function qs(params = {}) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const t = s.toString();
  return t ? `?${t}` : '';
}

/** Pages a reader that has to see every licence will follow before it stops. */
export const LEDGER_ALL_MAX_PAGES = 40;

export const licenceLedgerApi = {
  page: (params = {}) => request(`/admin/licences${qs(params)}`),
  summary: () => request('/admin/licences/summary'),
  requests: (uid, params = {}) => request(`/admin/licences/${enc(uid)}/requests${qs(params)}`),
  /**
   * Every licence, page by page, for a reader that needs them all (Revenue's
   * ceiling and statement pickers). `complete` is false when the pages ran
   * out before the cursor did, so a caller never shows a cut list as whole.
   */
  all: async () => {
    const items = [];
    let cursor = null;
    let total = null;
    for (let i = 0; i < LEDGER_ALL_MAX_PAGES; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request(`/admin/licences${qs({ limit: 100, cursor })}`);
      items.push(...(Array.isArray(r?.items) ? r.items : []));
      total = Number.isFinite(r?.total) ? r.total : total;
      cursor = r?.next_cursor || null;
      if (!cursor) return { items, total, complete: true };
    }
    return { items, total, complete: false };
  },
};
