import { request } from '../api.js';

/** D1150: selected firm's deal context; private notes have no staff bypass. */
export const dealContextApi = {
  stage: (id) => request(`/deals/${encodeURIComponent(id)}/stage`),
  whatsNew: (id) => request(`/deals/${encodeURIComponent(id)}/whats-new`),
  // #6192: `tag` narrows the page and its total to one tag; omitted, every note.
  notes: (id, { limit = 25, offset = 0, tag = '' } = {}) => request(`/deals/${encodeURIComponent(id)}/notes?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`),
  addNote: (id, body) => request(`/deals/${encodeURIComponent(id)}/notes`, { method: 'POST', body: JSON.stringify(body) }),
  editNote: (id, uid, body) => request(`/deals/${encodeURIComponent(id)}/notes/${encodeURIComponent(uid)}`, { method: 'PUT', body: JSON.stringify(body) }),
  // #6173 (D6173): the investment case — thesis fit, main evidence, open questions and risks, missing — each block its state.
  investmentCase: (id) => request(`/deals/${encodeURIComponent(id)}/case`),
  deleteNote: (id, uid) => request(`/deals/${encodeURIComponent(id)}/notes/${encodeURIComponent(uid)}`, { method: 'DELETE' }),
};
