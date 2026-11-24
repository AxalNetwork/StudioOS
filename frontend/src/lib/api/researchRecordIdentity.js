/** D7825 (#7825): record identity of a Research company or fund (`routes/research_record_identity.ts`): a member's read, and the admin writes. No screen yet. */
import { request } from '../api.js';

const at = (kind, uid) => `/research/record-identity/${encodeURIComponent(kind)}/${encodeURIComponent(uid)}`;
const send = (method, path, body) => request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const researchRecordIdentityApi = {
  read: (kind, uid) => request(at(kind, uid)),
  reviewDomain: (kind, uid, body) => send('POST', `${at(kind, uid)}/domains`, body),
  addName: (kind, uid, body) => send('POST', `${at(kind, uid)}/names`, body),
  correctName: (kind, uid, id, body) => send('PATCH', `${at(kind, uid)}/names/${encodeURIComponent(id)}`, body),
  removeName: (kind, uid, id) => send('DELETE', `${at(kind, uid)}/names/${encodeURIComponent(id)}`),
  addIdentifier: (kind, uid, body) => send('POST', `${at(kind, uid)}/identifiers`, body),
  correctIdentifier: (kind, uid, id, body) => send('PATCH', `${at(kind, uid)}/identifiers/${encodeURIComponent(id)}`, body),
  removeIdentifier: (kind, uid, id) => send('DELETE', `${at(kind, uid)}/identifiers/${encodeURIComponent(id)}`),
};
