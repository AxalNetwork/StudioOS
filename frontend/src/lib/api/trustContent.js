// D1075 (#2967, part 3 of #2425) — the public trust center's content store,
// its subprocessor notices, and Help's private Security reports.
// Worker: routes/trust_public.ts, routes/admin_trust_center.ts and
// routes/security_reports.ts over migration 584.
//
// Public, no session (`trustPublicApi`):
//   GET  /api/public/trust          → { blocks: { <key>: block|null }, subprocessors, changes, read_at }
//        A part that could not be read is { unreadable: true, message }; a block never
//        published is null and keeps the page's "Not recorded" line.
//   GET  /api/public/trust/changes?limit=  → { items: [{ uid, published_at, note, blocks, subprocessors }], complete }
//   GET  /api/public/trust/matrix   → { profiles, rows: [{ key, label, cells: { <profile>: { asked, renews_months }|null } }] }
//   POST /api/public/trust/subprocessors/subscribe { email, turnstileToken, hp }
//        → { ok, message } whatever the address (confirm by the emailed link)
// HQ › Security › Trust center content, Super Admin; writes take the write bar (`trustCenterAdminApi`):
//   GET    /api/admin/security/trust-center
//   PUT    /api/admin/security/trust-center/blocks/:key   { body, checked_at }
//   DELETE /api/admin/security/trust-center/blocks/:key/draft
//   POST   /api/admin/security/trust-center/subprocessors  { name, purpose, data, location, starts_at? }
//   PATCH  /api/admin/security/trust-center/subprocessors/:uid
//   DELETE /api/admin/security/trust-center/subprocessors/:uid   (a draft goes; a listed one is marked for removal)
//   POST   /api/admin/security/trust-center/subprocessors/:uid/keep
//   POST   /api/admin/security/trust-center/reports        (the auditor's report PDF as the body) → { uid }
//   POST   /api/admin/security/trust-center/publish        { note }  (10–1000 characters)
// Help's Security category (`securityReportsApi`):
//   POST  /api/help/security-reports   { affected, what_happened, how_to_reproduce? }
//   GET   /api/help/security-reports/mine
//   GET   /api/admin/security/reports[?status=]     (Super Admin)
//   PATCH /api/admin/security/reports/:uid { status }
import { request } from '../api.js';

const enc = encodeURIComponent;
const TC = '/admin/security/trust-center';
const SR = '/help/security-reports';

export const trustPublicApi = {
  read: () => request('/public/trust'),
  changes: (limit) => request(`/public/trust/changes${limit ? `?limit=${enc(limit)}` : ''}`),
  matrix: () => request('/public/trust/matrix'),
  subscribe: (body) => request('/public/trust/subprocessors/subscribe', { method: 'POST', body: JSON.stringify(body) }),
};

export const trustCenterAdminApi = {
  read: () => request(TC),
  saveDraft: (key, body) => request(`${TC}/blocks/${enc(key)}`, { method: 'PUT', body: JSON.stringify(body) }),
  discardDraft: (key) => request(`${TC}/blocks/${enc(key)}/draft`, { method: 'DELETE' }),
  addSubprocessor: (body) => request(`${TC}/subprocessors`, { method: 'POST', body: JSON.stringify(body) }),
  editSubprocessor: (uid, body) => request(`${TC}/subprocessors/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeSubprocessor: (uid) => request(`${TC}/subprocessors/${enc(uid)}`, { method: 'DELETE' }),
  keepSubprocessor: (uid) => request(`${TC}/subprocessors/${enc(uid)}/keep`, { method: 'POST' }),
  attachReport: (file) => request(`${TC}/reports`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/pdf' } }),
  publish: (note) => request(`${TC}/publish`, { method: 'POST', body: JSON.stringify({ note }) }),
};

export const securityReportsApi = {
  send: (body) => request(SR, { method: 'POST', body: JSON.stringify(body) }),
  mine: () => request(`${SR}/mine`),
  list: (status) => request(`/admin/security/reports${status ? `?status=${enc(status)}` : ''}`),
  setStatus: (uid, status) => request(`/admin/security/reports/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
};
