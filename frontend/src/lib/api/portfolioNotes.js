// D6222 (#6222) — an investor's private notes on a portfolio company. Worker:
// routes/portfolio_notes.ts, at /api/portfolio-notes.
//
// Only the author reads or writes a note; the company and other investors
// never see it. A note saved from Eadwyn's "What changed" names the two
// reports it compared. A support session reads and writes nothing
// (`can_write` false on the list, 403 `support_session_refused` on a write).
import { request } from '../api.js';

const company = (projectUid) => `/portfolio-notes/companies/${encodeURIComponent(projectUid)}`;
const note = (uid) => `/portfolio-notes/${encodeURIComponent(uid)}`;

export const portfolioNotesApi = {
  /** {items: [{uid, body, source, created_at, updated_at, edited}], can_write, write_refusal} */
  list: (projectUid) => request(company(projectUid)),
  /** {body, source?: 'what_changed', from_report_uid?, to_report_uid?} → {note} */
  create: (projectUid, body) => request(company(projectUid), { method: 'POST', body: JSON.stringify(body) }),
  /** {body} → {note} */
  edit: (uid, body) => request(note(uid), { method: 'PUT', body: JSON.stringify({ body }) }),
  remove: (uid) => request(note(uid), { method: 'DELETE' }),
};
