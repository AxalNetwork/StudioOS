// D812 (#2258) — product testing. Worker: routes/testing.ts, migration 516.
// No UI here: the Studio card is D814, the pages D815.
//
// `productTestingApi`, a member:
//   programmes       GET  /testing/programmes                    → { items, consent: { version, text } }: open, for the caller's role, with places left
//   myApplications   GET  /testing/applications/mine             → { items }
//   apply            POST /testing/programmes/:uid/apply          { answers: string[], availability?, consent_email? } → { application };
//                                                                 409 not_open | programme_full | already_applied, 403 not_eligible
//   withdraw         POST /testing/applications/:uid/withdraw     → { application }
//   summary          GET  /testing/summary                        → { open_count, picked: [...] }; open_count counts for an active tester only (D1336)
//   tester           GET  /testing/tester                          → D1336: { tester: { status, applied_at, decided_at, reason, reapply_after,
//                                                                 left_by_member, availability, consent_version, consent_current } | { status: null },
//                                                                 consent: { version, text }, can_apply, cannot_apply: { code, message } | null }; 403 admin_account
//   joinPool         POST /testing/tester/apply                    { consent_version, availability? } → the same, 201;
//                                                                 400 consent_required, 409 already_applied | already_tester | reapply_later | removed_by_hq
//   leavePool        POST /testing/tester/leave                    → the same; 409 not_in_pool. Picked places carry on.
//   programmes and apply answer 403 not_active_tester to anyone not an active tester (D1336).
//   myApplications rows carry finished, decides_by and withdrawn_by ('member' | 'hq' | null) (D1336).
//   logoSrc          GET  /testing/programmes/:uid/logo            the image for an <img>; 404 when there is none (D1199)
//
// `partnerTestingApi`, a partner on their firm's programmes:
//   programmes       GET   /partner/testing/programmes            → { items }
//   create           POST  /partner/testing/programmes            → { programme } (a draft)
//   edit             PATCH /partner/testing/programmes/:uid        a draft, or one HQ sent back (it returns to draft)
//   submit           POST  /partner/testing/programmes/:uid/submit → { programme } (waiting for HQ)
//   applicants       GET   /partner/testing/programmes/:uid/applicants → { programme, items }
//   pick / decline   POST  /partner/testing/applications/:uid/pick|decline → { application }; 409 programme_full
//   uploadLogo       PUT   /partner/testing/programmes/:uid/logo   multipart `file`, a square PNG or SVG → { logo } (D1199)
//   removeLogo       DELETE /partner/testing/programmes/:uid/logo  → { logo: { logo_key: null } }
//
// `adminTestingApi`, Super Admin:
//   programmes       GET   /admin/testing/programmes?status=
//   approve / reject POST  /admin/testing/programmes/:uid/approve|reject { note } (reject needs one)
//   open / close     POST  /admin/testing/programmes/:uid/open|close → { programme, told: { owner } }
//   startTesting     POST  /admin/testing/programmes/:uid/testing   → { programme, told: { owner, testers, mail_reach } };
//                                                                 open or closed only, else 409 not_testable (D1198)
//   withdraw         POST  /admin/testing/applications/:uid/withdraw { reason } (10 to 500 characters)
//                                                               → { application, freed_place, told: { member } };
//                                                                 400 invalid_request, 409 not_withdrawable (D1198)
//   `told` is counts only: `owner` is null for HQ's own programme, `mail_reach`
//   how many Mail's testers:<uid> rule would write to. StudioOS sends no email.
//   create, edit, pick, decline, uploadLogo, removeLogo: as the partner's, on HQ's own programmes.
//   overview         GET   /admin/testing/overview → D1196: { weekly, by_profile: { pool, applicants }, withdrawn,
//                    mail_reach }, each block { available: true, … } or { available: false, reason }; counts only.
//   applicants       GET   /admin/testing/programmes/:uid/applicants → { programme, items, can_decide }:
//                         any programme's (D1197); a partner's is read only, `can_decide: false`
//   events           GET   /admin/testing/programmes/:uid/events?page=&page_size= → { programme, events: { available, page, total, items } }
//   applications     GET   /admin/testing/applications?programme=&owner=&status=&role=&consented=&tester=&q=&sort=&page=&page_size=&scope=
//                         → { applications: { available, page, total, sort, scope, counts, items } }; status none leaves withdrawn out, `all` keeps it;
//                         D1203: `scope=open` keeps open and testing programmes; `counts` is one count per status under the other filters
//
// `adminProductTestersApi`, the tester pool (D1042's store, migration 576; read by
// D1195's Tester pool tab):
//   list             GET   /admin/product-testers?status=&page=   → { rows, page, page_size, matching, totals }
//
// `adminProductTestersApi`, the tester pool (D1042's store, migration 576; read by
// D1195's Tester pool tab):
//   list             GET   /admin/product-testers?status=&page=&page_size=&role=&availability_given=&in_programme=
//                         → { rows, page, page_size, matching, totals } (D1200's filters; D1204 reads the pool whole)
//
// Every path is written out in full so the drift check (scripts/check-api-drift.mjs)
// reads each one against the Worker.
import { request } from '../api.js';

const enc = encodeURIComponent;
const logoForm = (file) => { const form = new FormData(); form.set('file', file); return form; };
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
  tester: () => request('/testing/tester'),
  joinPool: ({ consentVersion, availability = null } = {}) => request('/testing/tester/apply', { method: 'POST', body: JSON.stringify({
    consent_version: consentVersion, availability,
  }) }),
  leavePool: () => request('/testing/tester/leave', { method: 'POST' }),
  logoSrc: (uid) => `/api/testing/programmes/${enc(uid)}/logo`,
};

export const partnerTestingApi = {
  programmes: () => request('/partner/testing/programmes'),
  create: (programme) => request('/partner/testing/programmes', { method: 'POST', body: JSON.stringify(programme) }),
  edit: (uid, changes) => request(`/partner/testing/programmes/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(changes) }),
  submit: (uid) => request(`/partner/testing/programmes/${enc(uid)}/submit`, { method: 'POST' }),
  applicants: (uid) => request(`/partner/testing/programmes/${enc(uid)}/applicants`),
  pick: (uid) => request(`/partner/testing/applications/${enc(uid)}/pick`, { method: 'POST' }),
  decline: (uid) => request(`/partner/testing/applications/${enc(uid)}/decline`, { method: 'POST' }),
  uploadLogo: (uid, file) => request(`/partner/testing/programmes/${enc(uid)}/logo`, { method: 'PUT', body: logoForm(file) }),
  removeLogo: (uid) => request(`/partner/testing/programmes/${enc(uid)}/logo`, { method: 'DELETE' }),
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
  startTesting: (uid) => request(`/admin/testing/programmes/${enc(uid)}/testing`, { method: 'POST' }),
  withdraw: (uid, reason) => request(`/admin/testing/applications/${enc(uid)}/withdraw`, { method: 'POST', body: JSON.stringify({ reason }) }),
  create: (programme) => request('/admin/testing/programmes', { method: 'POST', body: JSON.stringify(programme) }),
  edit: (uid, changes) => request(`/admin/testing/programmes/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(changes) }),
  applicants: (uid) => request(`/admin/testing/programmes/${enc(uid)}/applicants`),
  events: (uid, { page = 1, pageSize } = {}) => {
    const q = new URLSearchParams({ page: String(page) });
    if (pageSize) q.set('page_size', String(pageSize));
    return request(`/admin/testing/programmes/${enc(uid)}/events?${q}`);
  },
  applications: (filters = {}) => {
    const q = new URLSearchParams();
    for (const k of ['programme', 'owner', 'status', 'role', 'consented', 'tester', 'q', 'sort', 'page', 'page_size', 'scope']) {
      if (filters[k] != null && filters[k] !== '') q.set(k, String(filters[k]));
    }
    const qs = q.toString();
    return request(`/admin/testing/applications${qs ? `?${qs}` : ''}`);
  },
  pick: (uid) => request(`/admin/testing/applications/${enc(uid)}/pick`, { method: 'POST' }),
  decline: (uid) => request(`/admin/testing/applications/${enc(uid)}/decline`, { method: 'POST' }),
  overview: () => request('/admin/testing/overview'),
  uploadLogo: (uid, file) => request(`/admin/testing/programmes/${enc(uid)}/logo`, { method: 'PUT', body: logoForm(file) }),
  removeLogo: (uid) => request(`/admin/testing/programmes/${enc(uid)}/logo`, { method: 'DELETE' }),
};

export const TESTER_STATUSES = ['applied', 'active', 'paused', 'declined', 'removed'];

export const adminProductTestersApi = {
  list: (status, page = 1, { pageSize, role, availabilityGiven, inProgramme } = {}) => {
    if (status != null && status !== '' && !TESTER_STATUSES.includes(status)) throw new Error(`Unknown tester status: ${status}`);
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (page > 1) q.set('page', String(page));
    if (pageSize) q.set('page_size', String(pageSize));
    if (role) q.set('role', role);
    if (availabilityGiven) q.set('availability_given', availabilityGiven);
    if (inProgramme) q.set('in_programme', inProgramme);
    const qs = q.toString();
    return request(`/admin/product-testers${qs ? `?${qs}` : ''}`);
  },
};
