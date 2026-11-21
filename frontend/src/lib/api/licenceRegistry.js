// D5060 (#5060, user licences 4/4) — HQ's Licences registry across every licence family: operator (territory, white
// label, master franchise) and user (Founder, Investor, Operating Partner, Advisor).
// Worker: routes/admin_licence_registry.ts over services/licenceRegistry.ts (Super Admin).
//   GET /api/admin/licence-registry?family=&holder=user:<id>|entity:<id>&status=&q=&limit=&cursor=
//        → { available, family, items, total, limit, next_cursor|null, counts }
//          | { available: false, state: 'not_recorded', reason, items: null, total: null }
//   GET /api/admin/licence-registry/templates → { items: [{ slug, title, licence_type, authored, refusal, … }] }
//   GET /api/admin/licence-registry/:uid      → { available, layout: 'operator' | 'user', overview, programs, agreement, … }
import { request } from '../api.js';

const enc = encodeURIComponent;

function qs(params = {}) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const t = s.toString();
  return t ? `?${t}` : '';
}

export const licenceRegistryApi = {
  /** One page of the registry. `params`: { family, holder, status, q, limit, cursor }; empty values are left out. */
  page: (params = {}) => request(`/admin/licence-registry${qs(params)}`),
  templates: () => request('/admin/licence-registry/templates'),
  detail: (uid) => request(`/admin/licence-registry/${enc(uid)}`),
};
