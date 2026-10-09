// D654 (#1466) — Grow › Share an update, on the founder's `portfolio_updates`
// row (Worker: routes/portfolio_updates.ts, migration 437).
//   create     POST /portfolio-updates             a draft update for the project
//   context    GET  /portfolio-updates/share/context   metrics (each with source
//              and date; a missing one is null, "Not recorded"), open roles,
//              audience counts, ask kinds
//   draftLines POST /portfolio-updates/share/draft-lines  Eadwyn's highlights and
//              lowlights, each citing its source; { status: 'nothing' } when the
//              period holds nothing new
//   save       PUT  /portfolio-updates/:uid/share  the sheet's steps on the draft
//   send       POST /portfolio-updates/:uid/send   sent once, through notifications
//   page       GET  /portfolio-updates/:uid/page   the sent update; a recipient sees
//              what their audience may read
//   reply      POST /portfolio-updates/asks/:askUid/replies
//   askAgain   POST /portfolio-updates/asks/:askUid/ask-again
import { request } from '../api.js';

const enc = encodeURIComponent;

export const shareUpdateApi = {
  create: (projectId, title) => request('/portfolio-updates', {
    method: 'POST', body: JSON.stringify({ project_id: projectId, title, status: 'draft' }),
  }),
  context: (projectId, start, end) => request(
    `/portfolio-updates/share/context?project_id=${enc(projectId)}&period_start=${enc(start)}&period_end=${enc(end)}`,
  ),
  draftLines: (projectId, start, end) => request('/portfolio-updates/share/draft-lines', {
    method: 'POST', body: JSON.stringify({ project_id: projectId, period_start: start, period_end: end }),
  }),
  save: (uid, data) => request(`/portfolio-updates/${enc(uid)}/share`, { method: 'PUT', body: JSON.stringify(data) }),
  send: (uid) => request(`/portfolio-updates/${enc(uid)}/send`, { method: 'POST' }),
  page: (uid) => request(`/portfolio-updates/${enc(uid)}/page`),
  reply: (askUid, data) => request(`/portfolio-updates/asks/${enc(askUid)}/replies`, { method: 'POST', body: JSON.stringify(data) }),
  askAgain: (askUid) => request(`/portfolio-updates/asks/${enc(askUid)}/ask-again`, { method: 'POST' }),
};
