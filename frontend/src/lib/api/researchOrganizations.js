/** D7826 (#7826): Research organizations (`routes/research_organizations.ts`): a member's two reads, and the admin writes. No screen yet. */
import { request } from '../api.js';

const at = (uid) => `/research/organizations/${encodeURIComponent(uid)}`;
const send = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });
export const researchOrganizationsApi = {
  read: (uid) => request(at(uid)),
  ofRecord: (type, uid) => request(`/research/organizations/record/${encodeURIComponent(type)}/${encodeURIComponent(uid)}`),
  create: (body) => send('/research/organizations', body),
  addRole: (uid, body) => send(`${at(uid)}/roles`, body),
  confirmLink: (uid, body) => send(`${at(uid)}/links`, body),
  addRelationship: (uid, body) => send(`${at(uid)}/relationships`, body),
};
