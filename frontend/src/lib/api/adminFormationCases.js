/**
 * D6697 (#6697) — HQ's formation case reads (routes/admin_formation_cases.ts):
 * the queue with its saved views, one case, and the filings board. HQ admins
 * only; a branch is refused. Read only.
 *
 * `list({ view, country, partner, route, track, limit, offset })` → `{ items, total, views, … }`:
 * each item carries ages, party clocks and bands, never people or documents.
 * `get(uid)` → the case; `access` is `full` (people, documents and answers; the
 * read is written to the case's access log) for its assigned HQ owner and
 * Super Admins, else `counts`.
 * `filings({ state })` → `{ by_state, total }`, each filing with days since it was submitted.
 */
import { request } from '../api.js';

const qs = (params = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const adminFormationCasesApi = {
  list: (params) => request(`/admin/formation/cases${qs(params)}`),
  get: (uid) => request(`/admin/formation/cases/${encodeURIComponent(uid)}`),
  filings: (params) => request(`/admin/formation/filings${qs(params)}`),
};
