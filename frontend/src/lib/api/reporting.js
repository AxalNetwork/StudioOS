// D1058 (#2928, part 2 of #2427) — reporting duties and periods. Worker:
// routes/reporting.ts, at /api/reporting.
//
// The founder's desk reads a venture's duties, periods (each with its state
// worked out on read: upcoming, due, late, missing, sent or waived), the
// investors' asks and the reminder settings. The investor reads only the
// duties owed to them, and may ask once per late period or waive one.
//
// D1059 (#2929, part 3): a report built from the Grow modules. The founders
// open a period's draft, choose its figures, preview it as an investor or the
// team, and send it with the digest the preview gave; a sent report is
// corrected as a new revision. Statements are PDFs, read back no-store.
import { request } from '../api.js';
import { refusalError } from '../api.js';

const period = (uid) => `/reporting/periods/${encodeURIComponent(uid)}`;
const post = (path, body = {}) => request(path, { method: 'POST', body: JSON.stringify(body) });
const report = (uid) => `/reporting/reports/${encodeURIComponent(uid)}`;

// A statement (binary endpoint, not typed drift), read only when the reader
// taps it. It returns the blob and its filename and creates no object URL.
async function documentBlob(uid) {
  const token = localStorage.getItem('token');
  const res = await fetch(`/api/reporting/documents/${encodeURIComponent(uid)}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw await refusalError(res, 'The statement could not be downloaded.');
  const blob = await res.blob();
  const filename = (res.headers.get('Content-Disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || `statement-${uid}.pdf`;
  return { blob, filename };
}

export const reportingApi = {
  desk: (projectId) => request(`/reporting/desk?project=${encodeURIComponent(projectId)}`),
  /** {expected_on: 'YYYY-MM-DD', note?}: the founders' date, which the investor sees. */
  setExpected: (periodUid, expectedOn, note) => post(`${period(periodUid)}/expected`, { expected_on: expectedOn, note: note || undefined }),
  /** {project, offsets[], channels[], recipient_user_ids[]}: reminders go to the team only. */
  setReminders: (body) => request('/reporting/reminders', { method: 'PUT', body: JSON.stringify(body) }),
  portfolio: () => request('/reporting/portfolio'),
  company: (projectUid) => request(`/reporting/companies/${encodeURIComponent(projectUid)}`),
  /** D1061: the frozen figures of each report this investor received from one company; reading them records no open. */
  companyFigures: (projectUid) => request(`/reporting/companies/${encodeURIComponent(projectUid)}/figures`),
  /** Once per period, while it is late or missing. */
  ask: (periodUid) => post(`${period(periodUid)}/ask`),
  waive: (periodUid) => post(`${period(periodUid)}/waive`),
  /** Opens the period's report draft; preparing twice opens the same one. */
  draftReport: (periodUid) => post(`${period(periodUid)}/draft`),
  report: (uid) => request(report(uid)),
  /** {title?, body?, highlights?, lowlights?, figures?: [{key, include?, reason?, share?}], typed?, include_team?, correction_reason?} */
  saveReport: (uid, body) => request(report(uid), { method: 'PUT', body: JSON.stringify(body) }),
  /** as: 'investor' | 'team'. */
  previewReport: (uid, as = 'investor') => request(`${report(uid)}/preview?as=${encodeURIComponent(as)}`),
  /** Sends with the digest the founder last read; a drift is refused. */
  sendReport: (uid, figuresSha256) => post(`${report(uid)}/send`, { figures_sha256: figuresSha256 }),
  correctReport: (uid, reason) => post(`${report(uid)}/correct`, { reason }),
  /** {filename, label?, data: 'data:application/pdf;base64,…'} */
  attachReportDocument: (uid, body) => post(`${report(uid)}/documents`, body),
  reportDocument: (documentUid) => documentBlob(documentUid),
};
