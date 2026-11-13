// D1614 CO2–CO5 (#3976) — a company's compliance tasks. The page calls these
// through `pages/work/workAdapter.js` (and the Calendar's compliance sheet
// for a company-level task).
// Worker: routes/company_compliance.ts, mounted at /api/company.
//   GET    /company/:uid/compliance?status=&jurisdiction=&owner=&type=
//          → { company, viewer: { can_manage, can_comment, read_only }, tasks, truncated, projects }
//   POST   /company/:uid/compliance                  { title, due, type?, jurisdiction?, recurrence?, description?, project_id? } → { task }
//   GET    /company/:uid/compliance/assignable       → { team, platform, agents }
//   GET    /company/:uid/compliance/:task            → { company, viewer, task, timeline }
//   PATCH  /company/:uid/compliance/:task            { title?, due?, type?, jurisdiction?, recurrence?, description? } → { task }
//   PUT    /company/:uid/compliance/:task/assignee   { assignee: { kind, uid } | null } → { task }
//   POST   /company/:uid/compliance/:task/comments   { body } → { ok }
//   POST   /company/:uid/compliance/:task/ready      → { task }
//   POST   /company/:uid/compliance/:task/done       { note? } → { task }
//   POST   /company/:uid/compliance/:task/reopen     → { task }
//   POST   /company/:uid/compliance/:task/work       { project_id, title? } → { item }
// Refusals carry `error`: not_member, read_only_admin, not_company_admin,
// assignee_not_member, agent_cannot_close, company_mismatch,
// standalone_project, invalid_task. No email is in any reply.
import { request } from '../api.js';

const enc = encodeURIComponent;
const base = (uid) => `/company/${enc(uid)}/compliance`;
const send = (method, path, body) => request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const companyComplianceApi = {
  list: (uid, { status, jurisdiction, owner, type } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ status, jurisdiction, owner, type })) if (v) q.set(k, v);
    const qs = q.toString();
    return request(`${base(uid)}${qs ? `?${qs}` : ''}`);
  },
  task: (uid, taskUid) => request(`${base(uid)}/${enc(taskUid)}`),
  assignable: (uid) => request(`${base(uid)}/assignable`),
  create: (uid, body) => send('POST', base(uid), body),
  update: (uid, taskUid, body) => send('PATCH', `${base(uid)}/${enc(taskUid)}`, body),
  assign: (uid, taskUid, assignee) => send('PUT', `${base(uid)}/${enc(taskUid)}/assignee`, { assignee }),
  comment: (uid, taskUid, body) => send('POST', `${base(uid)}/${enc(taskUid)}/comments`, { body }),
  ready: (uid, taskUid) => send('POST', `${base(uid)}/${enc(taskUid)}/ready`, {}),
  markDone: (uid, taskUid, note) => send('POST', `${base(uid)}/${enc(taskUid)}/done`, note ? { note } : {}),
  reopen: (uid, taskUid) => send('POST', `${base(uid)}/${enc(taskUid)}/reopen`, {}),
  createWork: (uid, taskUid, { projectId, title } = {}) => send('POST', `${base(uid)}/${enc(taskUid)}/work`, { project_id: projectId, ...(title ? { title } : {}) }),
};
