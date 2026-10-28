/**
 * D1351 (#3566, part 2 of #3564) — the member's own book: LinkedIn's
 * Connections.csv imported on the server, the suggested duplicates it leaves,
 * and notes and follow-ups on a contact
 * (`cloudflare-worker/src/routes/contact_imports.ts`, under `/api/contacts`).
 * `preview` writes nothing; `importLinkedinCsv` writes one import job.
 */
import { request } from '../api.js';

const enc = encodeURIComponent;
const fileBody = (file) => { const fd = new FormData(); fd.append('file', file); return fd; };

export const contactsBookApi = {
  previewLinkedinCsv: (file) => request('/contacts/import/linkedin-csv?preview=1', { method: 'POST', body: fileBody(file) }),
  importLinkedinCsv: (file) => request('/contacts/import/linkedin-csv', { method: 'POST', body: fileBody(file) }),
  reviews: () => request('/contacts/import/reviews'),
  decideReview: (uid, decision) => request(`/contacts/import/reviews/${enc(uid)}/${enc(decision)}`, { method: 'POST' }),
  notes: (contactId) => request(`/contacts/book/${enc(contactId)}/notes`),
  addNote: (contactId, body) => request(`/contacts/book/${enc(contactId)}/notes`, { method: 'POST', body: JSON.stringify({ body }) }),
  tasks: (contactId) => request(`/contacts/book/${enc(contactId)}/tasks`),
  addTask: (contactId, title, dueOn = null) => request(`/contacts/book/${enc(contactId)}/tasks`, { method: 'POST', body: JSON.stringify({ title, due_on: dueOn }) }),
  setTaskDone: (contactId, uid, done) => request(`/contacts/book/${enc(contactId)}/tasks/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify({ done }) }),
};
