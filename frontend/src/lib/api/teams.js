// #3841 (part 4 of #3727) — the people on a company's or a project's team: the
// roster, its edits and its invitations, and the account search an invitation
// by name uses. Moved here from `api.js` (D527) with every method name kept.
// Worker: routes/company.ts (mounted at /api), routes/projects.ts (/api/projects),
// routes/account_companies.ts (/api).
//
// Company (`user_company_links`, migration 236's `company_invitations`):
//   GET    /api/company/:uid                               → the profile; `members[]` carries `email` on the caller's own row only
//   PATCH  /api/company/:uid/members/:userId               role, title, authority, carry, primary admin
//   DELETE /api/company/:uid/members/:userId
//   GET    /api/company/team-vocabulary                    the authority ladder and named functions
//   POST   /api/company/:uid/invitations                   { email, role_in_company, title?, authority? }
//   GET    /api/company/:uid/invitations
//   POST   /api/company/:uid/invitations/:inviteUid/resend → a new token; the old one fails at accept
//   DELETE /api/company/:uid/invitations/:inviteUid
// Project (migration 119's `project_members`, `project_member_invitations`):
//   GET    /api/projects/:id/members                       → `members[]` carries `email` on the caller's own row only
//   POST   /api/projects/:id/members                       the direct add (user_id | cofounder_match)
//   POST   /api/projects/:id/invitations                   { mode: 'email' | 'link' | 'account', email?, user_uid?, role }
//                                                          'account' invites a reachable account by uid; its email never comes back
//   POST   /api/projects/:id/invitations/:invId/resend     → { invitation: { id, status, source, expires_at, email_sent } }; 409 not_pending
//   POST   /api/projects/:id/invitations/:invId/revoke
//   DELETE /api/projects/:id/members/:userId
// People:
//   GET    /api/account/people/search?q=&company=|&project= → { people: [{ uid, name, avatar_url, shared: [{ kind, name }] }] }
//                                                          at most 10; only people who share a company or a connection; 400 query_too_short
import { request } from '../api.js';

const enc = encodeURIComponent;
const post = (path, data) => request(path, { method: 'POST', body: JSON.stringify(data || {}) });

export const teamsApi = {
  // Company
  getCompany: (uid) => request(`/company/${uid}`),
  // Wave 2 — role change / primary-admin transfer. Send only the keys you are changing.
  updateCompanyMember: (uid, userId, data) =>
    request(`/company/${uid}/members/${userId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  removeCompanyMember: (uid, userId) => request(`/company/${uid}/members/${userId}`, { method: 'DELETE' }),
  // The ladder, the named functions, and what each authority level MEANS.
  // A picker must never hardcode these — see services/teamAuthority.ts.
  teamVocabulary: () => request('/company/team-vocabulary'),
  // Task #121 — a real invitation (the direct add is retired, D434): the first
  // mails a hashed, expiring token; the invitee's own accept is in api.js.
  inviteCompanyMember: (uid, data) => post(`/company/${uid}/invitations`, data),
  listCompanyInvitations: (uid) => request(`/company/${uid}/invitations`),
  // A NEW token — nothing stored can reproduce the old one, which is the
  // point of storing only its hash.
  resendCompanyInvitation: (uid, inviteUid) =>
    request(`/company/${uid}/invitations/${inviteUid}/resend`, { method: 'POST' }),
  revokeCompanyInvitation: (uid, inviteUid) =>
    request(`/company/${uid}/invitations/${inviteUid}`, { method: 'DELETE' }),

  // Project — management (add/invite/resend/revoke/remove) is the owner's and
  // stage-gated server-side; the UI mirrors `can_manage` + `locked`.
  listProjectMembers: (id) => request(`/projects/${id}/members`),
  addProjectMember: (id, data) => post(`/projects/${id}/members`, data),
  createProjectInvitation: (id, data) => post(`/projects/${id}/invitations`, data),
  resendProjectInvitation: (id, invId) =>
    request(`/projects/${enc(id)}/invitations/${enc(invId)}/resend`, { method: 'POST' }),
  revokeProjectInvitation: (id, invId) =>
    request(`/projects/${id}/invitations/${invId}/revoke`, { method: 'POST' }),
  removeProjectMember: (id, userId) =>
    request(`/projects/${id}/members/${userId}`, { method: 'DELETE' }),

  // People — find an account to invite by name, never by email.
  searchPeople: (q, { company, project } = {}) => {
    const qs = new URLSearchParams({ q: String(q || '') });
    if (company) qs.set('company', company);
    else if (project != null && project !== '') qs.set('project', String(project));
    return request(`/account/people/search?${qs}`);
  },
};
