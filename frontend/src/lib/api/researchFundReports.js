// D7169 (#7169) — the quarterly reports in a private fund dossier
// (`/research/funds/:uid/reports`). `create` is create-only: a saved period
// answers 409 `period_exists` with `report`. `update` sends only the fields
// that changed (null clears one) with the row's `updated_at` as If-Match; a
// newer save answers 409 `report_changed` with the current `report`. A bad
// field answers 400 `invalid_report_field` with `errors: [{ field, detail }]`.
// Read by pages/research/FundReportsPanel.jsx and FundReportSheet.jsx.
import { request } from '../api.js';

export const researchFundReportsApi = {
  list: (fundUid) => request(`/research/funds/${encodeURIComponent(fundUid)}/reports`),
  create: (fundUid, fields) => request(`/research/funds/${encodeURIComponent(fundUid)}/reports`, { method: 'POST', body: JSON.stringify(fields || {}) }),
  update: (fundUid, reportUid, fields, revision) => request(`/research/funds/${encodeURIComponent(fundUid)}/reports/${encodeURIComponent(reportUid)}`, {
    method: 'PATCH',
    headers: { 'If-Match': `"${revision}"` },
    body: JSON.stringify(fields || {}),
  }),
  remove: (fundUid, reportUid) => request(`/research/funds/${encodeURIComponent(fundUid)}/reports/${encodeURIComponent(reportUid)}`, { method: 'DELETE' }),
};
