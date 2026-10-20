// D812 (#2258) — product testing. Worker: routes/testing.ts, migration 516.
// No UI here: the Studio card is D814, the pages D815.
//
// `productTestingApi`, a member:
//   programmes       GET  /testing/programmes                    → { items, consent: { version, text } }: open, for the caller's role, with places left
//   myApplications   GET  /testing/applications/mine             → { items }
//   apply            POST /testing/programmes/:uid/apply          { answers: string[], availability?, consent_email? } → { application };
//                                                                 409 not_open | programme_full | already_applied, 403 not_eligible
//   withdraw         POST /testing/applications/:uid/withdraw     → { application }
//   summary          GET  /testing/summary                        → { open_count, picked: [...] }
//
// `partnerTestingApi`, a partner on their firm's programmes:
//   programmes       GET   /partner/testing/programmes            → { items }
//   create           POST  /partner/testing/programmes            → { programme } (a draft)
//   edit             PATCH /partner/testing/programmes/:uid        a draft, or one HQ sent back (it returns to draft)
//   submit           POST  /partner/testing/programmes/:uid/submit → { programme } (waiting for HQ)
//   applicants       GET   /partner/testing/programmes/:uid/applicants → { programme, items }
//   pick / decline   POST  /partner/testing/applications/:uid/pick|decline → { application }; 409 programme_full
//
// `adminTestingApi`, Super Admin:
//   programmes       GET   /admin/testing/programmes?status=
//   approve / reject POST  /admin/testing/programmes/:uid/approve|reject { note } (reject needs one)
//   open / close     POST  /admin/testing/programmes/:uid/open|close
//   create, edit, applicants, pick, decline: as the partner's, on HQ's own programmes.
//
// Every path is written out in full so the drift check (scripts/check-api-drift.mjs)
// reads each one against the Worker.
import { request } from '../api.js';

const enc = encodeURIComponent;
export const TESTING_STATUSES = ['draft', 'submitted', 'approved', 'open', 'testing', 'closed', 'rejected'];

export const productTestingApi = {
  programmes: () => request('/testing/programmes'),
  myApplications: () => request('/testing/applications/mine'),
  apply: (uid, { answers = [], availability = null, consentEmail = false } = {}) =>
    request(`/testing/programmes/${enc(uid)}/apply`, { method: 'POST', body: JSON.stringify({
      answers, availability, consent_email: consentEmail === true,
    }) }),
  withdraw: (uid) => request(`/testing/applications/${enc(uid)}/withdraw`, { method: 'POST' }),
  summary: () => request('/testing/summary'),
};

export const partnerTestingApi = {
  programmes: () => request('/partner/testing/programmes'),
  create: (programme) => request('/partner/testing/programmes', { method: 'POST', body: JSON.stringify(programme) }),
  edit: (uid, changes) => request(`/partner/testing/programmes/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(changes) }),
  submit: (uid) => request(`/partner/testing/programmes/${enc(uid)}/submit`, { method: 'POST' }),
  applicants: (uid) => request(`/partner/testing/programmes/${enc(uid)}/applicants`),
  pick: (uid) => request(`/partner/testing/applications/${enc(uid)}/pick`, { method: 'POST' }),
  decline: (uid) => request(`/partner/testing/applications/${enc(uid)}/decline`, { method: 'POST' }),
};

export const adminTestingApi = {
  programmes: (status) => {
    if (status != null && status !== '' && !TESTING_STATUSES.includes(status)) throw new Error(`Unknown programme status: ${status}`);
    return request(`/admin/testing/programmes${status ? `?status=${status}` : ''}`);
  },
  approve: (uid, note) => request(`/admin/testing/programmes/${enc(uid)}/approve`, { method: 'POST', body: JSON.stringify({ note: note ?? null }) }),
  reject: (uid, note) => request(`/admin/testing/programmes/${enc(uid)}/reject`, { method: 'POST', body: JSON.stringify({ note }) }),
  open: (uid) => request(`/admin/testing/programmes/${enc(uid)}/open`, { method: 'POST' }),
  close: (uid) => request(`/admin/testing/programmes/${enc(uid)}/close`, { method: 'POST' }),
  create: (programme) => request('/admin/testing/programmes', { method: 'POST', body: JSON.stringify(programme) }),
  edit: (uid, changes) => request(`/admin/testing/programmes/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(changes) }),
  applicants: (uid) => request(`/admin/testing/programmes/${enc(uid)}/applicants`),
  pick: (uid) => request(`/admin/testing/applications/${enc(uid)}/pick`, { method: 'POST' }),
  decline: (uid) => request(`/admin/testing/applications/${enc(uid)}/decline`, { method: 'POST' }),
};
