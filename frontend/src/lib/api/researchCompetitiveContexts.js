// Save, read, list, edit and delete a member's own competitive contexts, and read a saved version (D7835).
import { request } from '../api.js';

const base = '/research/competitive-contexts';
const contextPath = (uid) => `${base}/${encodeURIComponent(uid)}`;
const send = (method, body) => ({ method, body: JSON.stringify(body) });

export const researchCompetitiveContextsApi = {
  list: () => request(base),
  create: (body) => request(base, send('POST', body)),
  read: (uid) => request(contextPath(uid)),
  save: (uid, body) => request(contextPath(uid), send('PUT', body)),
  remove: (uid, version) => request(`${contextPath(uid)}?version=${encodeURIComponent(version)}`, { method: 'DELETE' }),
  readVersion: (uid, version) => request(`${contextPath(uid)}/versions/${encodeURIComponent(version)}`),
};
