import { request } from '../api.js';

/** D1150: selected firm's deal context; private notes have no staff bypass. */
export const dealContextApi = {
  stage: (id) => request(`/deals/${encodeURIComponent(id)}/stage`),
  whatsNew: (id) => request(`/deals/${encodeURIComponent(id)}/whats-new`),
  notes: (id, { limit = 25, offset = 0 } = {}) => request(`/deals/${encodeURIComponent(id)}/notes?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`),
  addNote: (id, body) => request(`/deals/${encodeURIComponent(id)}/notes`, { method: 'POST', body: JSON.stringify(body) }),
  editNote: (id, uid, body) => request(`/deals/${encodeURIComponent(id)}/notes/${encodeURIComponent(uid)}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteNote: (id, uid) => request(`/deals/${encodeURIComponent(id)}/notes/${encodeURIComponent(uid)}`, { method: 'DELETE' }),
};
