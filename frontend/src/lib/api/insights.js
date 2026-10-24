import { request } from '../api.js';

// D893 (#2660) — Admin › Insights' one read, on routes/admin_insights.ts. Any
// admin; counts only. Each block is `{ available: true, … }`, `{ available:
// false, unreadable: true, reason }` or `{ recorded: false, reason }`.
//   adminInsights  GET /admin/insights  { range: '8w'|'quarter'|'year', profile, country, compare: 1, group, scope }
//                  → { range, weeks, current_week, last_complete_week, as_of, scope: { key, label }, filters,
//                      kpis: { accounts, new_this_week, active_last_week, activated },
//                      blocks: { who, plan, growth, activity, activation, retention, countries, identity,
//                                completeness, dormant, tickets, spend },
//                      group?, definitions }
// Another scope answers 403 `hq_only` (a plain Admin) or 400 `scope_unavailable` (#2662).
//   insightsExport POST /admin/insights/export  { what: 'page'|'group', format: 'csv'|'pdf', range, profile, country, group }
//                  → { download_url, expires_in_seconds, format: 'csv'|'pdf'|'html', what, range }
// D893 (#2661), on routes/admin_insights_export.ts: the same read as a logged,
// counts-only file behind a signed 24-hour link. `format` 'html' is a PDF
// Browser Run could not render. 503 `export_not_logged` hands out no file.
function query(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    q.set(k, v === true ? '1' : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const insightsApi = {
  adminInsights: (params) => request(`/admin/insights${query(params)}`),
  insightsExport: (body) => request('/admin/insights/export', { method: 'POST', body: JSON.stringify(body) }),
};
