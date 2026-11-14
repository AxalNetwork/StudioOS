// D963 (#2796, Programs part 10) — the client for part 5's Referral partners
// routes (D958, #2791). Worker: routes/admin_referral_partners.ts, mounted at
// /api/admin/referral-partners, every route `requireHqAdmin`.
//   GET   /                      ?q=&segment=&terms=&status=&sort=&limit=&offset=  the partners, paged with `total`
//   GET   /summary               ?quarter=2026-Q4   the tiles; money is `{ available: false, reason: 'hq_reads' }` for an Admin
//   GET   /series                introductions by week, segment and outcome; commission by month (Super Admin)
//   GET   /terms                 ?status=submitted&limit=&offset=   one stored state, oldest first (the Queue tab)
//   POST  /terms                 { user_id, starts_on, ends_on?, triggers, … }   a draft
//   PATCH /terms/:uid            edit a draft (409 `terms_not_draft` otherwise)
//   POST  /terms/:uid/submit     draft → submitted
//   POST  /terms/:uid/approve    submitted → approved: the Super Admin, behind the step-up bar
//   POST  /terms/:uid/preview    { template_version? } → { pdf_base64, body_sha256, template_version }
//   POST  /terms/:uid/send       { preview_sha256, template_version, provider } approved → sent
//   POST  /terms/:uid/end        { reason } signed or active → ended
//   GET   /:userId/terms         one partner's terms, newest first
import { request } from '../api.js';

const enc = encodeURIComponent;
const BASE = '/admin/referral-partners';
const query = (params) => {
  const s = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== '' && v != null)).toString();
  return s ? `?${s}` : '';
};
const post = (body) => ({ method: 'POST', body: JSON.stringify(body || {}) });

export const referralPartnersApi = {
  list: (params) => request(`${BASE}${query(params)}`),
  summary: (params) => request(`${BASE}/summary${query(params)}`),
  series: () => request(`${BASE}/series`),
  terms: (params) => request(`${BASE}/terms${query(params)}`),
  partnerTerms: (userId) => request(`${BASE}/${enc(userId)}/terms`),
  draft: (body) => request(`${BASE}/terms`, post(body)),
  editDraft: (uid, body) => request(`${BASE}/terms/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(body || {}) }),
  submit: (uid) => request(`${BASE}/terms/${enc(uid)}/submit`, post({})),
  approve: (uid) => request(`${BASE}/terms/${enc(uid)}/approve`, post({})),
  preview: (uid, body) => request(`${BASE}/terms/${enc(uid)}/preview`, post(body)),
  send: (uid, body) => request(`${BASE}/terms/${enc(uid)}/send`, post(body)),
  end: (uid, reason) => request(`${BASE}/terms/${enc(uid)}/end`, post({ reason })),
};
