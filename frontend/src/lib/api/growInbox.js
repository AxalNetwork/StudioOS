// D4494: Distribution Inbox reads and personal read receipts on the mounted /api/grow/inbox router.
import { request } from '../api.js';
const id = (value) => encodeURIComponent(String(value));
export const growInboxApi = {
  list: (project, q = '') => request('/grow/inbox?project=' + id(project) + (q ? '&q=' + id(q) : '')),
  thread: (project, contactUid) => request('/grow/inbox/' + id(contactUid) + '?project=' + id(project)),
  unread: (project) => request('/grow/inbox/unread-count?project=' + id(project)),
  read: (project, contactUid, messageKeys) => request('/grow/inbox/' + id(contactUid) + '/read', { method: 'POST', body: JSON.stringify({ project, message_keys: messageKeys }) }),
};
